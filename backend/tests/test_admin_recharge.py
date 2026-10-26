"""
Test suite for Admin Create Recharge feature
Tests the POST /api/wallet/admin-recharge endpoint and related functionality
"""
import pytest
import requests
import os
import io
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://pdf-horizontal-fix.preview.emergentagent.com')

# Test credentials
ADMIN_EMAIL = "admin@outletsusaec.com"
ADMIN_PASSWORD = "admin123"


class TestAdminRecharge:
    """Tests for admin-recharge endpoint"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session with auth"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login as admin
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "identifier": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert login_response.status_code == 200, f"Admin login failed: {login_response.text}"
        
        login_data = login_response.json()
        self.token = login_data["token"]
        self.tenant_id = login_data["tenant_id"]
        self.admin_user_id = login_data["user_id"]
        self.session.headers.update({"Authorization": f"Bearer {self.token}"})
        
        # Get a test client
        clients_response = self.session.get(f"{BASE_URL}/api/admin/clients")
        assert clients_response.status_code == 200, f"Failed to get clients: {clients_response.text}"
        
        clients = clients_response.json()
        if clients:
            self.test_client = clients[0]
            self.test_client_id = self.test_client["id"]
            self.test_customer_id = self.test_client["customer_id"]
        else:
            self.test_client = None
            self.test_client_id = None
            self.test_customer_id = None
        
        yield
    
    def test_admin_login_success(self):
        """Test admin can login successfully"""
        response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "identifier": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert response.status_code == 200
        data = response.json()
        assert "token" in data
        assert data["role"] == "admin"
        print(f"✓ Admin login successful - role: {data['role']}")
    
    def test_get_clients_list(self):
        """Test admin can get list of clients"""
        response = self.session.get(f"{BASE_URL}/api/admin/clients")
        assert response.status_code == 200
        clients = response.json()
        assert isinstance(clients, list)
        print(f"✓ Got {len(clients)} clients")
    
    def test_admin_recharge_requires_auth(self):
        """Test that admin-recharge endpoint requires authentication"""
        # Create a new session without auth
        no_auth_session = requests.Session()
        
        # Create a fake file
        files = {
            'proof': ('test.png', io.BytesIO(b'fake image content'), 'image/png')
        }
        data = {
            'user_id': 'fake-id',
            'amount': '100'
        }
        
        response = no_auth_session.post(f"{BASE_URL}/api/wallet/admin-recharge", data=data, files=files)
        assert response.status_code == 401 or response.status_code == 422, f"Expected 401/422, got {response.status_code}"
        print("✓ Admin recharge requires authentication")
    
    def test_admin_recharge_requires_client(self):
        """Test that admin-recharge requires a valid client"""
        # Create a fake PNG file (minimal valid PNG header)
        png_header = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde'
        
        files = {
            'proof': ('test.png', io.BytesIO(png_header), 'image/png')
        }
        data = {
            'user_id': 'non-existent-user-id',
            'amount': '100'
        }
        
        # Remove Content-Type header for multipart
        headers = {"Authorization": f"Bearer {self.token}"}
        response = requests.post(f"{BASE_URL}/api/wallet/admin-recharge", data=data, files=files, headers=headers)
        assert response.status_code == 404, f"Expected 404, got {response.status_code}: {response.text}"
        print("✓ Admin recharge validates client exists")
    
    def test_admin_recharge_requires_positive_amount(self):
        """Test that admin-recharge requires amount > 0"""
        if not self.test_client_id:
            pytest.skip("No test client available")
        
        png_header = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde'
        
        files = {
            'proof': ('test.png', io.BytesIO(png_header), 'image/png')
        }
        data = {
            'user_id': self.test_client_id,
            'amount': '0'
        }
        
        headers = {"Authorization": f"Bearer {self.token}"}
        response = requests.post(f"{BASE_URL}/api/wallet/admin-recharge", data=data, files=files, headers=headers)
        assert response.status_code == 400, f"Expected 400, got {response.status_code}: {response.text}"
        assert "mayor a 0" in response.json().get("detail", "").lower() or "monto" in response.json().get("detail", "").lower()
        print("✓ Admin recharge validates amount > 0")
    
    def test_admin_recharge_requires_proof(self):
        """Test that admin-recharge requires proof file"""
        if not self.test_client_id:
            pytest.skip("No test client available")
        
        data = {
            'user_id': self.test_client_id,
            'amount': '100'
        }
        
        headers = {"Authorization": f"Bearer {self.token}"}
        response = requests.post(f"{BASE_URL}/api/wallet/admin-recharge", data=data, headers=headers)
        # Should fail because proof is required
        assert response.status_code == 422, f"Expected 422 (validation error), got {response.status_code}: {response.text}"
        print("✓ Admin recharge requires proof file")
    
    def test_admin_recharge_success(self):
        """Test successful admin recharge creation"""
        if not self.test_client_id:
            pytest.skip("No test client available")
        
        # Get initial wallet balance
        wallet_response = self.session.get(f"{BASE_URL}/api/wallet/{self.test_client_id}")
        assert wallet_response.status_code == 200, f"Failed to get wallet: {wallet_response.text}"
        initial_balance = wallet_response.json()["available"]
        
        # Create recharge with proof
        recharge_amount = 25.50
        png_header = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde'
        
        files = {
            'proof': ('test_recharge.png', io.BytesIO(png_header), 'image/png')
        }
        data = {
            'user_id': self.test_client_id,
            'amount': str(recharge_amount),
            'description': 'TEST_Recarga de prueba automatizada'
        }
        
        headers = {"Authorization": f"Bearer {self.token}"}
        response = requests.post(f"{BASE_URL}/api/wallet/admin-recharge", data=data, files=files, headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        result = response.json()
        assert "transaction_id" in result
        assert result["amount_credited"] == recharge_amount
        assert result["new_balance"] == initial_balance + recharge_amount
        
        print(f"✓ Admin recharge created successfully - Amount: ${recharge_amount}, New balance: ${result['new_balance']}")
        
        # Verify wallet was updated
        wallet_response = self.session.get(f"{BASE_URL}/api/wallet/{self.test_client_id}")
        assert wallet_response.status_code == 200
        new_balance = wallet_response.json()["available"]
        assert new_balance == initial_balance + recharge_amount, f"Wallet not updated: expected {initial_balance + recharge_amount}, got {new_balance}"
        print(f"✓ Wallet balance verified: ${new_balance}")
        
        return result["transaction_id"]
    
    def test_admin_recharge_appears_in_history(self):
        """Test that admin recharge appears in deposit history"""
        if not self.test_client_id:
            pytest.skip("No test client available")
        
        # First create a recharge
        recharge_amount = 15.00
        png_header = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde'
        
        files = {
            'proof': ('test_history.png', io.BytesIO(png_header), 'image/png')
        }
        data = {
            'user_id': self.test_client_id,
            'amount': str(recharge_amount),
            'description': 'TEST_Recarga para historial'
        }
        
        headers = {"Authorization": f"Bearer {self.token}"}
        response = requests.post(f"{BASE_URL}/api/wallet/admin-recharge", data=data, files=files, headers=headers)
        assert response.status_code == 200, f"Failed to create recharge: {response.text}"
        
        tx_id = response.json()["transaction_id"]
        
        # Check all deposits
        deposits_response = self.session.get(f"{BASE_URL}/api/wallet/all-deposits")
        assert deposits_response.status_code == 200
        
        deposits = deposits_response.json()
        found = False
        for deposit in deposits:
            if deposit.get("id") == tx_id:
                found = True
                assert deposit["status"] == "approved", f"Expected status 'approved', got {deposit['status']}"
                assert deposit["amount"] == recharge_amount
                assert "proof_url" in deposit
                break
        
        assert found, f"Transaction {tx_id} not found in deposits history"
        print(f"✓ Admin recharge appears in history with status 'approved'")
    
    def test_admin_recharge_logged_in_audit(self):
        """Test that admin recharge is logged in audit trail"""
        if not self.test_client_id:
            pytest.skip("No test client available")
        
        # Create a recharge
        recharge_amount = 10.00
        png_header = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde'
        
        files = {
            'proof': ('test_audit.png', io.BytesIO(png_header), 'image/png')
        }
        data = {
            'user_id': self.test_client_id,
            'amount': str(recharge_amount),
            'description': 'TEST_Recarga para auditoría'
        }
        
        headers = {"Authorization": f"Bearer {self.token}"}
        response = requests.post(f"{BASE_URL}/api/wallet/admin-recharge", data=data, files=files, headers=headers)
        assert response.status_code == 200, f"Failed to create recharge: {response.text}"
        
        tx_id = response.json()["transaction_id"]
        
        # Wait a moment for audit log to be written
        time.sleep(0.5)
        
        # Check audit logs
        audit_response = self.session.get(f"{BASE_URL}/api/admin/audit-logs", params={"action": "create_recharge"})
        assert audit_response.status_code == 200, f"Failed to get audit logs: {audit_response.text}"
        
        audit_data = audit_response.json()
        logs = audit_data.get("logs", [])
        
        found = False
        for log in logs:
            if log.get("entity_id") == tx_id:
                found = True
                assert log["action"] == "create_recharge"
                assert log["entity_type"] == "wallet_transaction"
                assert "amount" in log.get("details", {})
                break
        
        assert found, f"Audit log for transaction {tx_id} not found"
        print(f"✓ Admin recharge logged in audit trail with action='create_recharge'")
    
    def test_client_receives_notification(self):
        """Test that client receives notification after admin recharge"""
        if not self.test_client_id:
            pytest.skip("No test client available")
        
        # Create a recharge
        recharge_amount = 5.00
        png_header = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde'
        
        files = {
            'proof': ('test_notif.png', io.BytesIO(png_header), 'image/png')
        }
        data = {
            'user_id': self.test_client_id,
            'amount': str(recharge_amount),
            'description': 'TEST_Recarga para notificación'
        }
        
        headers = {"Authorization": f"Bearer {self.token}"}
        response = requests.post(f"{BASE_URL}/api/wallet/admin-recharge", data=data, files=files, headers=headers)
        assert response.status_code == 200, f"Failed to create recharge: {response.text}"
        
        # Check notifications for the client
        notif_response = self.session.get(f"{BASE_URL}/api/notifications/{self.test_client_id}")
        assert notif_response.status_code == 200, f"Failed to get notifications: {notif_response.text}"
        
        notifications = notif_response.json()
        
        # Find the wallet_credited notification
        found = False
        for notif in notifications:
            if notif.get("type") == "wallet_credited" and str(recharge_amount) in notif.get("message", ""):
                found = True
                assert "Recarga Acreditada" in notif.get("title", "")
                break
        
        assert found, "Client notification for recharge not found"
        print(f"✓ Client received notification for recharge")


class TestAdminRechargeUI:
    """Tests for admin recharge UI elements (data-testid verification)"""
    
    def test_ui_elements_exist(self):
        """Verify expected data-testid attributes exist in frontend code"""
        # This test verifies the frontend has the expected test IDs
        expected_testids = [
            "create-recharge-btn",
            "recharge-client-search-input",
            "recharge-select-client-trigger",
            "recharge-amount-input",
            "recharge-description-input",
            "recharge-proof-input",
            "confirm-recharge-btn"
        ]
        
        # Read the AdminWallet.jsx file
        try:
            with open("/app/frontend/src/pages/AdminWallet.jsx", "r") as f:
                content = f.read()
            
            for testid in expected_testids:
                assert f'data-testid="{testid}"' in content, f"Missing data-testid: {testid}"
                print(f"✓ Found data-testid: {testid}")
        except FileNotFoundError:
            pytest.skip("AdminWallet.jsx not found - running in remote environment")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
