"""
Multi-Tenant SaaS Platform Backend Tests
Testing: Auth, Superadmin, Admin, Client, Wallet, Live, Purchase flows
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://pdf-horizontal-fix.preview.emergentagent.com')

# Store shared test data
TEST_DATA = {}

class TestHealthAndBasics:
    """Basic health and API availability tests"""
    
    def test_health_endpoint(self):
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        print(f"Health check passed: {data}")
    
    def test_root_api(self):
        response = requests.get(f"{BASE_URL}/api/")
        assert response.status_code == 200
        data = response.json()
        assert "SaaS" in data["message"] or "Live" in data["message"]
        print(f"Root API response: {data}")


class TestSuperadminFlow:
    """Superadmin seed, login, and tenant management tests"""
    
    def test_01_seed_superadmin(self):
        """Seed superadmin - should return success or 'already exists'"""
        response = requests.post(f"{BASE_URL}/api/superadmin/seed")
        assert response.status_code == 200
        data = response.json()
        assert "email" in data or "message" in data
        print(f"Seed superadmin result: {data}")
    
    def test_02_superadmin_login(self):
        """Login as superadmin and store token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "identifier": "superadmin@outletsusaec.com",
            "password": "super123"
        })
        assert response.status_code == 200
        data = response.json()
        assert data["role"] == "superadmin"
        assert "token" in data
        TEST_DATA["superadmin_token"] = data["token"]
        print(f"Superadmin login successful, role={data['role']}")
    
    def test_03_superadmin_stats(self):
        """Get superadmin stats with JWT"""
        headers = {"Authorization": f"Bearer {TEST_DATA['superadmin_token']}"}
        response = requests.get(f"{BASE_URL}/api/superadmin/stats", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "tenant_count" in data
        assert "active_tenants" in data
        assert "total_admins" in data
        assert "total_clients" in data
        print(f"Superadmin stats: {data}")
    
    def test_04_list_tenants(self):
        """List all tenants - superadmin only"""
        headers = {"Authorization": f"Bearer {TEST_DATA['superadmin_token']}"}
        response = requests.get(f"{BASE_URL}/api/superadmin/tenants", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        # Check if outlets-usa tenant exists
        outlets_tenant = next((t for t in data if t["slug"] == "outlets-usa"), None)
        if outlets_tenant:
            TEST_DATA["outlets_tenant_id"] = outlets_tenant["id"]
            print(f"Found outlets-usa tenant: {outlets_tenant['id']}")
        print(f"Total tenants: {len(data)}")
    
    def test_05_create_new_tenant(self):
        """Create a new test tenant with admin"""
        headers = {"Authorization": f"Bearer {TEST_DATA['superadmin_token']}"}
        unique_slug = f"test-tenant-{int(time.time())}"
        response = requests.post(f"{BASE_URL}/api/superadmin/tenants", headers=headers, json={
            "business_name": "Test Business",
            "slug": unique_slug,
            "owner_name": "Test Owner",
            "email": "test@business.com",
            "admin_name": "Test Admin",
            "admin_email": f"admin-{unique_slug}@test.com",
            "admin_password": "testadmin123",
            "admin_whatsapp": "+1234567890",
            "admin_country": "USA"
        })
        assert response.status_code == 200
        data = response.json()
        assert "tenant_id" in data
        assert "admin_id" in data
        TEST_DATA["test_tenant_id"] = data["tenant_id"]
        TEST_DATA["test_tenant_slug"] = unique_slug
        TEST_DATA["test_admin_email"] = f"admin-{unique_slug}@test.com"
        print(f"Created tenant: {data}")
    
    def test_06_suspend_tenant(self):
        """Suspend a tenant"""
        if "test_tenant_id" not in TEST_DATA:
            pytest.skip("No test tenant to suspend")
        headers = {"Authorization": f"Bearer {TEST_DATA['superadmin_token']}"}
        response = requests.put(
            f"{BASE_URL}/api/superadmin/tenants/{TEST_DATA['test_tenant_id']}?status=suspended",
            headers=headers
        )
        assert response.status_code == 200
        data = response.json()
        assert "suspended" in data["message"].lower() or "actualizado" in data["message"].lower()
        print(f"Suspend tenant result: {data}")
    
    def test_07_activate_tenant(self):
        """Re-activate a tenant"""
        if "test_tenant_id" not in TEST_DATA:
            pytest.skip("No test tenant to activate")
        headers = {"Authorization": f"Bearer {TEST_DATA['superadmin_token']}"}
        response = requests.put(
            f"{BASE_URL}/api/superadmin/tenants/{TEST_DATA['test_tenant_id']}?status=active",
            headers=headers
        )
        assert response.status_code == 200
        print(f"Activate tenant result: {response.json()}")


class TestAdminFlow:
    """Admin login and client management tests"""
    
    def test_01_admin_login(self):
        """Login as admin for outlets-usa tenant"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "identifier": "admin@outletsusaec.com",
            "password": "admin123"
        })
        assert response.status_code == 200
        data = response.json()
        assert data["role"] == "admin"
        assert "token" in data
        assert data.get("tenant_id") is not None
        assert data.get("tenant_name") is not None
        TEST_DATA["admin_token"] = data["token"]
        TEST_DATA["admin_tenant_id"] = data["tenant_id"]
        print(f"Admin login successful: tenant={data.get('tenant_name')}, role={data['role']}")
    
    def test_02_get_my_tenant(self):
        """Admin gets own tenant info"""
        headers = {"Authorization": f"Bearer {TEST_DATA['admin_token']}"}
        response = requests.get(f"{BASE_URL}/api/admin/tenant", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "business_name" in data
        assert "slug" in data
        print(f"Admin tenant: {data['business_name']} ({data['slug']})")
    
    def test_03_list_clients(self):
        """Admin lists clients scoped to their tenant"""
        headers = {"Authorization": f"Bearer {TEST_DATA['admin_token']}"}
        response = requests.get(f"{BASE_URL}/api/admin/clients", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        # Store existing client for further tests
        if data:
            TEST_DATA["existing_client"] = data[0]
        print(f"Admin sees {len(data)} clients")
        for c in data[:3]:
            print(f"  - #{c['customer_id']} {c['name']} (balance: ${c.get('wallet_balance', 0)})")
    
    def test_04_create_client(self):
        """Admin creates a new client"""
        headers = {"Authorization": f"Bearer {TEST_DATA['admin_token']}"}
        unique_whatsapp = f"+1555{int(time.time()) % 10000000:07d}"
        response = requests.post(f"{BASE_URL}/api/admin/clients/create", headers=headers, json={
            "name": "TEST Client Created",
            "country": "Ecuador",
            "whatsapp": unique_whatsapp,
            "email": f"test-{int(time.time())}@client.com",
            "password": "clientpass123",
            "commission_fee": 3.5,
            "initial_balance": 100.0
        })
        assert response.status_code == 200
        data = response.json()
        assert "user_id" in data
        assert "customer_id" in data
        TEST_DATA["created_client_id"] = data["user_id"]
        TEST_DATA["created_customer_id"] = data["customer_id"]
        print(f"Created client: #{data['customer_id']}, commission=${data.get('commission_fee', 3)}")
    
    def test_05_update_client_commission(self):
        """Admin updates client commission"""
        if "created_client_id" not in TEST_DATA:
            pytest.skip("No created client to update")
        headers = {"Authorization": f"Bearer {TEST_DATA['admin_token']}"}
        response = requests.put(
            f"{BASE_URL}/api/admin/clients/{TEST_DATA['created_client_id']}/commission?commission_fee=4.50",
            headers=headers
        )
        assert response.status_code == 200
        data = response.json()
        assert data["commission_fee"] == 4.5
        print(f"Updated commission: ${data['commission_fee']}")
    
    def test_06_get_client_info(self):
        """Admin gets client info by customer_id"""
        if "created_customer_id" not in TEST_DATA:
            pytest.skip("No client to query")
        headers = {"Authorization": f"Bearer {TEST_DATA['admin_token']}"}
        response = requests.get(
            f"{BASE_URL}/api/admin/clients/{TEST_DATA['created_customer_id']}/info",
            headers=headers
        )
        assert response.status_code == 200
        data = response.json()
        assert data["customer_id"] == TEST_DATA["created_customer_id"]
        assert data["commission_fee"] == 4.5  # Updated in previous test
        print(f"Client info: {data['name']}, commission=${data['commission_fee']}")
    
    def test_07_get_active_clients(self):
        """Admin gets clients with positive balance"""
        headers = {"Authorization": f"Bearer {TEST_DATA['admin_token']}"}
        response = requests.get(f"{BASE_URL}/api/admin/clients/active", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        # All should have positive balance
        for c in data:
            assert c.get("wallet_balance", 0) > 0
        print(f"Active clients with balance: {len(data)}")


class TestWalletFlow:
    """Wallet operations tests"""
    
    def test_01_get_wallet_by_user_id(self):
        """Get wallet by user_id"""
        if "created_client_id" not in TEST_DATA:
            pytest.skip("No client created")
        headers = {"Authorization": f"Bearer {TEST_DATA['admin_token']}"}
        response = requests.get(
            f"{BASE_URL}/api/wallet/{TEST_DATA['created_client_id']}",
            headers=headers
        )
        assert response.status_code == 200
        data = response.json()
        assert data["available"] == 100.0  # Initial balance
        print(f"Wallet balance: ${data['available']}")
    
    def test_02_get_wallet_by_customer_id(self):
        """Get wallet by customer_id"""
        if "created_customer_id" not in TEST_DATA:
            pytest.skip("No client created")
        headers = {"Authorization": f"Bearer {TEST_DATA['admin_token']}"}
        response = requests.get(
            f"{BASE_URL}/api/wallet/by-customer/{TEST_DATA['created_customer_id']}",
            headers=headers
        )
        assert response.status_code == 200
        data = response.json()
        assert data["customer_id"] == TEST_DATA["created_customer_id"]
        print(f"Wallet by customer_id: ${data['available']}")
    
    def test_03_request_deposit(self):
        """Request a deposit (client-initiated)"""
        if "created_client_id" not in TEST_DATA:
            pytest.skip("No client created")
        headers = {"Authorization": f"Bearer {TEST_DATA['admin_token']}"}
        response = requests.post(
            f"{BASE_URL}/api/wallet/deposit-request",
            headers=headers,
            json={
                "user_id": TEST_DATA["created_client_id"],
                "amount": 50.0,
                "description": "Test deposit request"
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert "transaction_id" in data
        TEST_DATA["deposit_tx_id"] = data["transaction_id"]
        print(f"Deposit request created: {data['transaction_id']}")
    
    def test_04_get_pending_deposits(self):
        """Admin gets pending deposits"""
        headers = {"Authorization": f"Bearer {TEST_DATA['admin_token']}"}
        response = requests.get(f"{BASE_URL}/api/wallet/pending-deposits", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        # Should have at least our pending deposit
        pending = [d for d in data if d.get("id") == TEST_DATA.get("deposit_tx_id")]
        print(f"Pending deposits: {len(data)}, our tx found: {len(pending) > 0}")
    
    def test_05_approve_deposit(self):
        """Admin approves deposit"""
        if "deposit_tx_id" not in TEST_DATA:
            pytest.skip("No deposit to approve")
        headers = {"Authorization": f"Bearer {TEST_DATA['admin_token']}"}
        response = requests.post(
            f"{BASE_URL}/api/wallet/approve-deposit/{TEST_DATA['deposit_tx_id']}",
            headers=headers
        )
        assert response.status_code == 200
        data = response.json()
        assert data["new_balance"] == 150.0  # 100 initial + 50 deposit
        print(f"Deposit approved, new balance: ${data['new_balance']}")
    
    def test_06_get_wallet_transactions(self):
        """Get wallet transaction history"""
        if "created_client_id" not in TEST_DATA:
            pytest.skip("No client created")
        headers = {"Authorization": f"Bearer {TEST_DATA['admin_token']}"}
        response = requests.get(
            f"{BASE_URL}/api/wallet/transactions/{TEST_DATA['created_client_id']}",
            headers=headers
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 2  # Initial + approved deposit
        print(f"Wallet transactions: {len(data)}")


class TestLiveShoppingFlow:
    """Live session and purchase tests"""
    
    def test_01_create_live(self):
        """Admin creates a live session"""
        headers = {"Authorization": f"Bearer {TEST_DATA['admin_token']}"}
        response = requests.post(
            f"{BASE_URL}/api/lives",
            headers=headers,
            json={"title": "Test Live Session"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "live_id" in data
        TEST_DATA["live_id"] = data["live_id"]
        print(f"Created live: {data['live_id']}")
    
    def test_02_start_live(self):
        """Admin starts the live session"""
        if "live_id" not in TEST_DATA:
            pytest.skip("No live to start")
        headers = {"Authorization": f"Bearer {TEST_DATA['admin_token']}"}
        response = requests.post(
            f"{BASE_URL}/api/lives/{TEST_DATA['live_id']}/start",
            headers=headers
        )
        assert response.status_code == 200
        print(f"Live started: {response.json()}")
    
    def test_03_get_active_live(self):
        """Get currently active live"""
        headers = {"Authorization": f"Bearer {TEST_DATA['admin_token']}"}
        response = requests.get(f"{BASE_URL}/api/lives/active", headers=headers)
        assert response.status_code == 200
        data = response.json()
        if data:
            assert data["status"] == "active"
            print(f"Active live: {data['title']}")
        else:
            print("No active live (may have ended)")
    
    def test_04_get_lives_list(self):
        """Get list of lives"""
        headers = {"Authorization": f"Bearer {TEST_DATA['admin_token']}"}
        response = requests.get(f"{BASE_URL}/api/lives", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Total lives: {len(data)}")
    
    def test_05_create_purchase_tax_calculation(self):
        """Create purchase and verify tax (8.25%) and commission deduction"""
        if "live_id" not in TEST_DATA or "created_customer_id" not in TEST_DATA:
            pytest.skip("Missing live or client")
        headers = {"Authorization": f"Bearer {TEST_DATA['admin_token']}"}
        price = 100.0
        response = requests.post(
            f"{BASE_URL}/api/purchases",
            headers=headers,
            json={
                "customer_id": TEST_DATA["created_customer_id"],
                "item_name": "Test Product",
                "store": "Test Store",
                "price": price,
                "live_id": TEST_DATA["live_id"]
            }
        )
        assert response.status_code == 200
        data = response.json()
        
        # Verify tax calculation (8.25%)
        expected_tax = round(price * 0.0825, 2)
        assert data["tax"] == expected_tax, f"Tax should be {expected_tax}, got {data['tax']}"
        
        # Verify price_with_tax
        expected_price_with_tax = round(price + expected_tax, 2)
        assert data["price_with_tax"] == expected_price_with_tax
        
        # Verify only commission is deducted (4.5 from previous test)
        assert data["commission"] == 4.5
        assert data["commission_deducted"] == 4.5
        
        # Verify new balance: 150 - 4.5 = 145.5
        assert data["new_balance"] == 145.5
        
        TEST_DATA["purchase_id"] = data["purchase_id"]
        print(f"Purchase created: price=${price}, tax=${data['tax']}, commission=${data['commission']}")
        print(f"  Total display: ${data['total']}, But only commission deducted: ${data['commission_deducted']}")
        print(f"  New wallet balance: ${data['new_balance']}")
    
    def test_06_get_live_purchases(self):
        """Get purchases for a live session"""
        if "live_id" not in TEST_DATA:
            pytest.skip("No live session")
        headers = {"Authorization": f"Bearer {TEST_DATA['admin_token']}"}
        response = requests.get(
            f"{BASE_URL}/api/purchases/live/{TEST_DATA['live_id']}",
            headers=headers
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 1
        print(f"Live purchases: {len(data)}")
    
    def test_07_end_live(self):
        """Admin ends the live session"""
        if "live_id" not in TEST_DATA:
            pytest.skip("No live to end")
        headers = {"Authorization": f"Bearer {TEST_DATA['admin_token']}"}
        response = requests.post(
            f"{BASE_URL}/api/lives/{TEST_DATA['live_id']}/end",
            headers=headers
        )
        assert response.status_code == 200
        print(f"Live ended: {response.json()}")
    
    def test_08_get_live_report(self):
        """Get live report with sales summary"""
        if "live_id" not in TEST_DATA:
            pytest.skip("No live session")
        headers = {"Authorization": f"Bearer {TEST_DATA['admin_token']}"}
        response = requests.get(
            f"{BASE_URL}/api/admin/reports/live/{TEST_DATA['live_id']}",
            headers=headers
        )
        assert response.status_code == 200
        data = response.json()
        assert "live" in data
        assert "purchases" in data
        assert "total_sales" in data
        print(f"Live report: sales=${data['total_sales']}, commissions=${data['total_commissions']}")


class TestClientSelfRegistration:
    """Client self-registration with tenant slug"""
    
    def test_01_register_with_valid_tenant_slug(self):
        """Register as client with valid tenant slug"""
        unique_whatsapp = f"+1666{int(time.time()) % 10000000:07d}"
        response = requests.post(f"{BASE_URL}/api/auth/register", json={
            "tenant_slug": "outlets-usa",
            "name": "Self Registered Client",
            "country": "Colombia",
            "whatsapp": unique_whatsapp,
            "email": f"selfregister-{int(time.time())}@test.com",
            "password": "selfregister123",
            "referral_code": ""
        })
        assert response.status_code == 200
        data = response.json()
        assert data["role"] == "client"
        assert "token" in data
        assert "customer_id" in data
        assert data["tenant_id"] is not None
        TEST_DATA["self_registered_token"] = data["token"]
        TEST_DATA["self_registered_user_id"] = data["user_id"]
        print(f"Self-registered client: #{data['customer_id']}, tenant={data['tenant_name']}")
    
    def test_02_register_with_invalid_tenant_slug(self):
        """Register with invalid tenant slug should fail"""
        response = requests.post(f"{BASE_URL}/api/auth/register", json={
            "tenant_slug": "non-existent-tenant-xyz",
            "name": "Invalid Client",
            "country": "Peru",
            "whatsapp": "+1999999999",
            "password": "invalid123"
        })
        assert response.status_code == 404
        print(f"Invalid slug correctly rejected: {response.json()}")
    
    def test_03_client_login_and_access(self):
        """Self-registered client can login and access their data"""
        if "self_registered_token" not in TEST_DATA:
            pytest.skip("No self-registered client")
        headers = {"Authorization": f"Bearer {TEST_DATA['self_registered_token']}"}
        response = requests.get(
            f"{BASE_URL}/api/wallet/{TEST_DATA['self_registered_user_id']}",
            headers=headers
        )
        assert response.status_code == 200
        data = response.json()
        assert data["available"] == 0.0  # New client starts with 0
        print(f"Self-registered client wallet: ${data['available']}")


class TestTenantIsolation:
    """Verify data is properly isolated by tenant"""
    
    def test_01_admin_cannot_see_other_tenant_clients(self):
        """Admin should only see clients from their tenant"""
        # Create new tenant admin
        if "test_admin_email" not in TEST_DATA:
            pytest.skip("No test tenant admin")
        
        # Login as test tenant admin
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "identifier": TEST_DATA["test_admin_email"],
            "password": "testadmin123"
        })
        assert response.status_code == 200
        test_admin_token = response.json()["token"]
        
        # Try to get clients - should be empty or only test tenant clients
        headers = {"Authorization": f"Bearer {test_admin_token}"}
        response = requests.get(f"{BASE_URL}/api/admin/clients", headers=headers)
        assert response.status_code == 200
        clients = response.json()
        
        # Should NOT see clients from outlets-usa tenant
        for client in clients:
            assert client.get("tenant_id") == TEST_DATA.get("test_tenant_id")
        
        print(f"Test tenant admin sees {len(clients)} clients (isolated)")


class TestReportsAndSettings:
    """Admin reports and settings tests"""
    
    def test_01_get_reports_summary(self):
        """Admin gets summary report"""
        headers = {"Authorization": f"Bearer {TEST_DATA['admin_token']}"}
        response = requests.get(f"{BASE_URL}/api/admin/reports/summary", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "total_sales" in data
        assert "total_commissions" in data
        assert "client_count" in data
        print(f"Report summary: sales=${data['total_sales']}, commissions=${data['total_commissions']}")
    
    def test_02_get_referral_bonus(self):
        """Get referral bonus setting"""
        headers = {"Authorization": f"Bearer {TEST_DATA['admin_token']}"}
        response = requests.get(f"{BASE_URL}/api/admin/settings/referral-bonus", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "referral_bonus" in data
        print(f"Referral bonus: ${data['referral_bonus']}")
    
    def test_03_set_referral_bonus(self):
        """Update referral bonus"""
        headers = {"Authorization": f"Bearer {TEST_DATA['admin_token']}"}
        response = requests.put(
            f"{BASE_URL}/api/admin/settings/referral-bonus?amount=7.5",
            headers=headers
        )
        assert response.status_code == 200
        data = response.json()
        assert data["referral_bonus"] == 7.5
        print(f"Updated referral bonus: ${data['referral_bonus']}")
    
    def test_04_get_referral_stats(self):
        """Get referral statistics"""
        headers = {"Authorization": f"Bearer {TEST_DATA['admin_token']}"}
        response = requests.get(f"{BASE_URL}/api/admin/referrals", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "top_referrers" in data
        assert "total_bonus_paid" in data
        print(f"Referral stats: total_bonus_paid=${data['total_bonus_paid']}")


class TestUnauthorizedAccess:
    """Test that unauthorized access is properly blocked"""
    
    def test_01_no_token_access(self):
        """Requests without token should fail"""
        response = requests.get(f"{BASE_URL}/api/admin/clients")
        assert response.status_code in [401, 422]  # 422 for missing header
        print("No token correctly rejected")
    
    def test_02_client_cannot_access_admin_endpoints(self):
        """Client token cannot access admin endpoints"""
        if "self_registered_token" not in TEST_DATA:
            pytest.skip("No client token")
        headers = {"Authorization": f"Bearer {TEST_DATA['self_registered_token']}"}
        response = requests.get(f"{BASE_URL}/api/admin/clients", headers=headers)
        assert response.status_code == 403
        print("Client correctly blocked from admin endpoints")
    
    def test_03_admin_cannot_access_superadmin_endpoints(self):
        """Admin token cannot access superadmin endpoints"""
        headers = {"Authorization": f"Bearer {TEST_DATA['admin_token']}"}
        response = requests.get(f"{BASE_URL}/api/superadmin/tenants", headers=headers)
        assert response.status_code == 403
        print("Admin correctly blocked from superadmin endpoints")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
