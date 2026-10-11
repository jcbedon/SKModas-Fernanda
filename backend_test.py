import requests
import sys
import json
from datetime import datetime

class OutletsUSAAPITester:
    def __init__(self, base_url="https://personal-shopper-13.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.admin_token = None
        self.client_token = None
        self.test_client_id = None
        self.test_user_id = None
        self.test_live_id = None
        self.tests_run = 0
        self.tests_passed = 0
        self.failed_tests = []

    def run_test(self, name, method, endpoint, expected_status, data=None, headers=None):
        """Run a single API test"""
        url = f"{self.base_url}/{endpoint}"
        default_headers = {'Content-Type': 'application/json'}
        if headers:
            default_headers.update(headers)

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=default_headers)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=default_headers)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=default_headers)

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                try:
                    return True, response.json()
                except:
                    return True, {}
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                print(f"   Response: {response.text[:200]}")
                self.failed_tests.append({
                    "test": name,
                    "expected": expected_status,
                    "actual": response.status_code,
                    "response": response.text[:200]
                })
                return False, {}

        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            self.failed_tests.append({
                "test": name,
                "error": str(e)
            })
            return False, {}

    def test_health_check(self):
        """Test API health"""
        return self.run_test("Health Check", "GET", "", 200)

    def test_seed_admin(self):
        """Test admin seeding"""
        success, response = self.run_test("Seed Admin", "POST", "admin/seed", 200)
        return success

    def test_admin_login(self):
        """Test admin login"""
        success, response = self.run_test(
            "Admin Login",
            "POST",
            "auth/login",
            200,
            data={"identifier": "admin@outletsusaec.com", "password": "admin123"}
        )
        if success and 'user_id' in response:
            self.admin_token = response.get('user_id')  # Store for future requests
            return True
        return False

    def test_client_registration(self):
        """Test client registration with unique ID generation"""
        timestamp = datetime.now().strftime('%H%M%S')
        success, response = self.run_test(
            "Client Registration",
            "POST",
            "auth/register",
            200,
            data={
                "name": f"Juan Test{timestamp}",
                "country": "Ecuador",
                "whatsapp": f"+593999{timestamp}",
                "email": f"juan{timestamp}@test.com",
                "password": "test123",
                "whatsapp_consent": True
            }
        )
        if success and 'customer_id' in response:
            self.test_client_id = response['customer_id']
            self.test_user_id = response['user_id']
            print(f"   Generated Customer ID: {self.test_client_id}")
            # Verify ID format (letter + 4 digits)
            if len(self.test_client_id) == 5 and self.test_client_id[0].isalpha() and self.test_client_id[1:].isdigit():
                print(f"   ✅ Customer ID format correct: {self.test_client_id}")
                return True
            else:
                print(f"   ❌ Customer ID format incorrect: {self.test_client_id}")
                return False
        return False

    def test_client_login(self):
        """Test client login"""
        if not self.test_client_id:
            return False
        
        success, response = self.run_test(
            "Client Login",
            "POST",
            "auth/login",
            200,
            data={"identifier": self.test_client_id, "password": "test123"}
        )
        return success

    def test_wallet_operations(self):
        """Test wallet operations"""
        if not self.test_user_id:
            return False

        # Get wallet
        success, wallet = self.run_test(
            "Get Wallet",
            "GET",
            f"wallet/{self.test_user_id}",
            200
        )
        if not success:
            return False

        # Request deposit
        success, deposit_response = self.run_test(
            "Request Deposit",
            "POST",
            "wallet/deposit-request",
            200,
            data={
                "user_id": self.test_user_id,
                "amount": 100.0,
                "description": "Test deposit"
            }
        )
        if not success:
            return False

        # Get pending deposits (admin function)
        success, pending = self.run_test(
            "Get Pending Deposits",
            "GET",
            "wallet/pending-deposits",
            200
        )
        if not success:
            print("   ⚠️  Pending deposits endpoint failed, continuing...")

        # Approve deposit (admin function)
        if 'transaction_id' in deposit_response:
            success, approval = self.run_test(
                "Approve Deposit",
                "POST",
                f"wallet/approve-deposit/{deposit_response['transaction_id']}",
                200
            )
            if success:
                print("   ✅ Deposit approved, wallet should have balance now")
                return True

        return True

    def test_live_operations(self):
        """Test live shopping operations"""
        # Create live
        success, live_response = self.run_test(
            "Create Live",
            "POST",
            "lives",
            200,
            data={"title": "Test Live Session"}
        )
        if not success:
            return False

        if 'live_id' in live_response:
            self.test_live_id = live_response['live_id']

        # Start live
        success, _ = self.run_test(
            "Start Live",
            "POST",
            f"lives/{self.test_live_id}/start",
            200
        )
        if not success:
            return False

        # Get active live
        success, active_live = self.run_test(
            "Get Active Live",
            "GET",
            "lives/active",
            200
        )
        return success

    def test_purchase_operations(self):
        """Test purchase operations with commission"""
        if not self.test_client_id or not self.test_live_id:
            return False

        # Create purchase
        success, purchase_response = self.run_test(
            "Create Purchase",
            "POST",
            "purchases",
            200,
            data={
                "customer_id": self.test_client_id,
                "item_name": "Test Product",
                "store": "Walmart",
                "price": 25.99,
                "live_id": self.test_live_id
            }
        )
        if success:
            # Verify commission was added
            if 'total' in purchase_response:
                expected_total = 25.99 + 3.0  # price + commission
                actual_total = purchase_response['total']
                if abs(actual_total - expected_total) < 0.01:
                    print(f"   ✅ Commission correctly added: ${actual_total}")
                    return True
                else:
                    print(f"   ❌ Commission incorrect: expected ${expected_total}, got ${actual_total}")
                    return False
        return False

    def test_reports_and_admin(self):
        """Test admin reports and client management"""
        # Get all clients
        success, clients = self.run_test(
            "Get All Clients",
            "GET",
            "admin/clients",
            200
        )
        if not success:
            return False

        # Get reports summary
        success, summary = self.run_test(
            "Get Reports Summary",
            "GET",
            "admin/reports/summary",
            200
        )
        if success and isinstance(summary, dict):
            required_fields = ['total_sales', 'total_commissions', 'client_count']
            for field in required_fields:
                if field not in summary:
                    print(f"   ❌ Missing field in summary: {field}")
                    return False
            print(f"   ✅ Summary contains all required fields")
            return True
        return False

def main():
    print("🚀 Starting Outlets USA EC API Testing...")
    tester = OutletsUSAAPITester()

    # Test sequence
    tests = [
        ("Health Check", tester.test_health_check),
        ("Seed Admin", tester.test_seed_admin),
        ("Admin Login", tester.test_admin_login),
        ("Client Registration", tester.test_client_registration),
        ("Client Login", tester.test_client_login),
        ("Wallet Operations", tester.test_wallet_operations),
        ("Live Operations", tester.test_live_operations),
        ("Purchase Operations", tester.test_purchase_operations),
        ("Reports and Admin", tester.test_reports_and_admin),
    ]

    print(f"\n📋 Running {len(tests)} test categories...")
    
    for test_name, test_func in tests:
        print(f"\n{'='*50}")
        print(f"🧪 {test_name}")
        print('='*50)
        
        try:
            result = test_func()
            if result:
                print(f"✅ {test_name} - PASSED")
            else:
                print(f"❌ {test_name} - FAILED")
        except Exception as e:
            print(f"💥 {test_name} - ERROR: {str(e)}")

    # Final results
    print(f"\n{'='*60}")
    print(f"📊 FINAL RESULTS")
    print('='*60)
    print(f"Tests Run: {tester.tests_run}")
    print(f"Tests Passed: {tester.tests_passed}")
    print(f"Tests Failed: {tester.tests_run - tester.tests_passed}")
    print(f"Success Rate: {(tester.tests_passed/tester.tests_run*100):.1f}%")

    if tester.failed_tests:
        print(f"\n❌ FAILED TESTS:")
        for i, failure in enumerate(tester.failed_tests, 1):
            print(f"{i}. {failure.get('test', 'Unknown')}")
            if 'error' in failure:
                print(f"   Error: {failure['error']}")
            else:
                print(f"   Expected: {failure.get('expected')}, Got: {failure.get('actual')}")

    return 0 if tester.tests_passed == tester.tests_run else 1

if __name__ == "__main__":
    sys.exit(main())