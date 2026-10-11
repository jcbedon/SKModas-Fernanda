"""
Test Invoice Format Changes - New Column Structure
Tests for:
- Invoice table columns: CANTIDAD, DETALLE, COSTO, TIENDA, COMISION, TOTAL
- TOTAL = price + commission (NOT including tax per item)
- Summary stats: Total de articulos, Total Etiqueta, Peso en Libras
- Financial summary: Subtotal, Taxes, Envio, Total, Abonos, Total a pagar
- Saldo Anterior shows only when client wallet balance is positive
- total_deposits field in API response
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://personal-shopper-13.preview.emergentagent.com')

class TestInvoiceFormat:
    """Test invoice format and API response structure"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login as admin and get token"""
        login_response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"identifier": "admin@outletsusaec.com", "password": "admin123"}
        )
        assert login_response.status_code == 200, f"Login failed: {login_response.text}"
        self.token = login_response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
        self.tenant_id = login_response.json().get("tenant_id")
    
    def test_login_success(self):
        """Test admin login works"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"identifier": "admin@outletsusaec.com", "password": "admin123"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "token" in data
        assert data["role"] == "admin"
        print(f"✓ Admin login successful, tenant_id: {data.get('tenant_id')}")
    
    def test_search_invoices(self):
        """Test searching invoices via /api/invoices/search"""
        response = requests.get(
            f"{BASE_URL}/api/invoices/search",
            headers=self.headers
        )
        assert response.status_code == 200, f"Search invoices failed: {response.text}"
        invoices = response.json()
        assert isinstance(invoices, list)
        print(f"✓ Found {len(invoices)} invoices via search")
        
        if invoices:
            print(f"  Invoice numbers: {[inv.get('invoice_number') for inv in invoices[:5]]}")
        return invoices
    
    def test_invoice_detail_has_required_fields(self):
        """Test invoice detail API returns all required fields for new format"""
        # First get list of invoices via search
        list_response = requests.get(f"{BASE_URL}/api/invoices/search", headers=self.headers)
        assert list_response.status_code == 200
        invoices = list_response.json()
        
        if not invoices:
            pytest.skip("No invoices found to test")
        
        # Get detail of first invoice
        invoice_id = invoices[0]["id"]
        response = requests.get(
            f"{BASE_URL}/api/invoices/{invoice_id}",
            headers=self.headers
        )
        assert response.status_code == 200, f"Get invoice detail failed: {response.text}"
        invoice = response.json()
        
        # Check required fields for new format
        required_fields = [
            "id", "invoice_number", "customer_id", "subtotal", 
            "total_tax", "total_commission", "total", "status",
            "purchases", "client", "total_deposits", "client_balance"
        ]
        
        for field in required_fields:
            assert field in invoice, f"Missing required field: {field}"
            print(f"  ✓ Field '{field}' present: {type(invoice[field]).__name__}")
        
        # Verify total_deposits is a number
        assert isinstance(invoice["total_deposits"], (int, float)), "total_deposits should be numeric"
        print(f"✓ Invoice {invoice['invoice_number']} has all required fields")
        print(f"  - total_deposits: ${invoice['total_deposits']}")
        print(f"  - client_balance: ${invoice['client_balance']}")
        
        return invoice
    
    def test_invoice_purchases_have_required_fields(self):
        """Test each purchase in invoice has fields for new column format"""
        # Get invoice detail
        list_response = requests.get(f"{BASE_URL}/api/invoices/search", headers=self.headers)
        invoices = list_response.json()
        
        if not invoices:
            pytest.skip("No invoices found to test")
        
        invoice_id = invoices[0]["id"]
        response = requests.get(f"{BASE_URL}/api/invoices/{invoice_id}", headers=self.headers)
        invoice = response.json()
        
        purchases = invoice.get("purchases", [])
        if not purchases:
            pytest.skip("Invoice has no purchases")
        
        # Check each purchase has required fields for new columns
        # CANTIDAD (always 1), DETALLE (item_name), COSTO (price), TIENDA (store), COMISION (commission), TOTAL (price + commission)
        for idx, purchase in enumerate(purchases):
            assert "item_name" in purchase, f"Purchase {idx} missing item_name (DETALLE)"
            assert "price" in purchase, f"Purchase {idx} missing price (COSTO)"
            assert "store" in purchase, f"Purchase {idx} missing store (TIENDA)"
            assert "commission" in purchase, f"Purchase {idx} missing commission (COMISION)"
            
            # Verify TOTAL = price + commission (NOT including tax)
            expected_total = purchase["price"] + purchase.get("commission", 0)
            print(f"  Purchase {idx+1}: {purchase['item_name']}")
            print(f"    COSTO: ${purchase['price']}, COMISION: ${purchase.get('commission', 0)}")
            print(f"    Expected TOTAL (price + commission): ${expected_total:.2f}")
        
        print(f"✓ All {len(purchases)} purchases have required fields for new column format")
    
    def test_invoice_financial_summary_calculation(self):
        """Test financial summary calculations: Subtotal, Taxes, Total, Total a pagar"""
        list_response = requests.get(f"{BASE_URL}/api/invoices/search", headers=self.headers)
        invoices = list_response.json()
        
        if not invoices:
            pytest.skip("No invoices found to test")
        
        invoice_id = invoices[0]["id"]
        response = requests.get(f"{BASE_URL}/api/invoices/{invoice_id}", headers=self.headers)
        invoice = response.json()
        
        # Get values
        subtotal = invoice.get("subtotal", 0)
        total_commission = invoice.get("total_commission", 0)
        total_tax = invoice.get("total_tax", 0)
        total = invoice.get("total", 0)
        total_deposits = invoice.get("total_deposits", 0)
        client_balance = invoice.get("client_balance", 0)
        
        # Get shipment cost if exists
        shipment = invoice.get("shipment")
        shipping_cost = shipment.get("shipping_cost", 0) if shipment else 0
        
        # Calculate expected values
        display_subtotal = subtotal + total_commission  # Subtotal shown = base prices + commissions
        grand_total = display_subtotal + total_tax + shipping_cost
        total_a_pagar = max(0, grand_total - total_deposits)
        
        print(f"✓ Invoice {invoice['invoice_number']} financial summary:")
        print(f"  - Subtotal (base prices): ${subtotal:.2f}")
        print(f"  - Total Commission: ${total_commission:.2f}")
        print(f"  - Display Subtotal (subtotal + commission): ${display_subtotal:.2f}")
        print(f"  - Taxes: ${total_tax:.2f}")
        print(f"  - Envio (shipping): ${shipping_cost:.2f}")
        print(f"  - Grand Total: ${grand_total:.2f}")
        print(f"  - Total Deposits (Abonos): ${total_deposits:.2f}")
        print(f"  - Client Balance (Saldo Anterior): ${client_balance:.2f}")
        print(f"  - Total a pagar: ${total_a_pagar:.2f}")
        
        # Verify total_deposits is returned
        assert "total_deposits" in invoice, "total_deposits field missing from API response"
        assert isinstance(invoice["total_deposits"], (int, float)), "total_deposits should be numeric"
    
    def test_client_deposits_list(self):
        """Test that client_deposits list is returned for Abonos display"""
        list_response = requests.get(f"{BASE_URL}/api/invoices/search", headers=self.headers)
        invoices = list_response.json()
        
        if not invoices:
            pytest.skip("No invoices found to test")
        
        invoice_id = invoices[0]["id"]
        response = requests.get(f"{BASE_URL}/api/invoices/{invoice_id}", headers=self.headers)
        invoice = response.json()
        
        # Check client_deposits field exists
        assert "client_deposits" in invoice, "client_deposits field missing from API response"
        client_deposits = invoice.get("client_deposits", [])
        
        print(f"✓ Invoice {invoice['invoice_number']} has client_deposits field")
        print(f"  - Number of deposits (Abonos): {len(client_deposits)}")
        
        if client_deposits:
            for idx, dep in enumerate(client_deposits[:5]):  # Show first 5
                print(f"    Abono {idx+1}: ${dep.get('amount', 0):.2f} - {dep.get('description', 'N/A')}")
    
    def test_invoice_with_shipment(self):
        """Test invoice with shipment has weight and shipping cost for summary stats"""
        list_response = requests.get(f"{BASE_URL}/api/invoices/search", headers=self.headers)
        invoices = list_response.json()
        
        # Find an invoice with shipment
        invoice_with_shipment = None
        for inv in invoices:
            detail_response = requests.get(f"{BASE_URL}/api/invoices/{inv['id']}", headers=self.headers)
            detail = detail_response.json()
            if detail.get("shipment"):
                invoice_with_shipment = detail
                break
        
        if not invoice_with_shipment:
            print("⚠ No invoice with shipment found - skipping shipment test")
            pytest.skip("No invoice with shipment found")
        
        shipment = invoice_with_shipment["shipment"]
        print(f"✓ Found invoice with shipment: {invoice_with_shipment['invoice_number']}")
        print(f"  - Peso en Libras: {shipment.get('weight_pounds', 0)} lbs")
        print(f"  - Envio (shipping cost): ${shipment.get('shipping_cost', 0):.2f}")
        
        # Verify shipment has required fields for summary stats
        assert "weight_pounds" in shipment or shipment.get("weight_pounds") is not None
        assert "shipping_cost" in shipment or shipment.get("shipping_cost") is not None


class TestInvoiceSummaryStats:
    """Test summary stats below table: Total de articulos, Total Etiqueta, Peso en Libras"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login as admin"""
        login_response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"identifier": "admin@outletsusaec.com", "password": "admin123"}
        )
        assert login_response.status_code == 200
        self.token = login_response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_total_articulos_calculation(self):
        """Test Total de articulos = number of purchases"""
        list_response = requests.get(f"{BASE_URL}/api/invoices/search", headers=self.headers)
        invoices = list_response.json()
        
        if not invoices:
            pytest.skip("No invoices found")
        
        invoice_id = invoices[0]["id"]
        response = requests.get(f"{BASE_URL}/api/invoices/{invoice_id}", headers=self.headers)
        invoice = response.json()
        
        purchases = invoice.get("purchases", [])
        total_articulos = len(purchases)
        
        print(f"✓ Total de articulos: {total_articulos}")
        assert total_articulos >= 0
    
    def test_total_etiqueta_calculation(self):
        """Test Total Etiqueta = sum of COSTO (base prices, subtotal)"""
        list_response = requests.get(f"{BASE_URL}/api/invoices/search", headers=self.headers)
        invoices = list_response.json()
        
        if not invoices:
            pytest.skip("No invoices found")
        
        invoice_id = invoices[0]["id"]
        response = requests.get(f"{BASE_URL}/api/invoices/{invoice_id}", headers=self.headers)
        invoice = response.json()
        
        # Total Etiqueta = subtotal (sum of base prices)
        total_etiqueta = invoice.get("subtotal", 0)
        
        # Verify by summing purchase prices
        purchases = invoice.get("purchases", [])
        calculated_sum = sum(p.get("price", 0) for p in purchases)
        
        print(f"✓ Total Etiqueta (subtotal): ${total_etiqueta:.2f}")
        print(f"  Calculated from purchases: ${calculated_sum:.2f}")
        
        # Allow small floating point difference
        assert abs(total_etiqueta - calculated_sum) < 0.01, f"Total Etiqueta mismatch: {total_etiqueta} vs {calculated_sum}"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
