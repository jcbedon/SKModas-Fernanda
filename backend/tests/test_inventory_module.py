"""Backend tests for the Inventory module.

Covers:
- Product CRUD
- Sales creation and stock deduction
- Stock adjustment (+/-)
- Weekly stats endpoint with filters (week, w1, month, all)
"""
import os
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_IDENTIFIER = "admin@demo.com"
ADMIN_PASSWORD = "demo123"


@pytest.fixture(scope="module")
def auth_headers():
    r = requests.post(f"{API}/auth/login", json={"identifier": ADMIN_IDENTIFIER, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    token = r.json().get("token") or r.json().get("access_token")
    assert token, f"No token in response: {r.json()}"
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def created_product(auth_headers):
    payload = {
        "name": "TEST_InvProduct_Zeta",
        "cost": 10.0,
        "sale_price": 25.0,
        "tax_rate": 0.0825,
        "stock_ecuador": 20,
        "stock_usa": 10,
        "sku": "TEST-SKU-ZETA-01",
        "description": "Automated test product",
    }
    r = requests.post(f"{API}/inventory/products", json=payload, headers=auth_headers)
    assert r.status_code in (200, 201), r.text
    body = r.json()
    data = body.get("product", body)
    assert data["name"] == payload["name"]
    assert data["cost"] == 10.0
    assert data["sale_price"] == 25.0
    assert data["stock_ecuador"] == 20
    assert data["stock_usa"] == 10
    assert "id" in data
    yield data
    # teardown
    try:
        requests.delete(f"{API}/inventory/products/{data['id']}", headers=auth_headers)
    except Exception:
        pass


class TestInventoryProducts:
    def test_list_products(self, auth_headers, created_product):
        r = requests.get(f"{API}/inventory/products", headers=auth_headers)
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list)
        ids = [p["id"] for p in items]
        assert created_product["id"] in ids

    def test_get_product(self, auth_headers, created_product):
        r = requests.get(f"{API}/inventory/products/{created_product['id']}", headers=auth_headers)
        assert r.status_code == 200
        p = r.json()
        assert p["id"] == created_product["id"]
        assert p["sku"] == "TEST-SKU-ZETA-01"

    def test_update_product(self, auth_headers, created_product):
        r = requests.put(
            f"{API}/inventory/products/{created_product['id']}",
            json={"sale_price": 29.99},
            headers=auth_headers,
        )
        assert r.status_code == 200
        body = r.json()
        data = body.get("product", body)
        assert data["sale_price"] == 29.99
        # verify persistence
        r2 = requests.get(f"{API}/inventory/products/{created_product['id']}", headers=auth_headers)
        assert r2.json()["sale_price"] == 29.99


class TestInventorySales:
    def test_create_sale_deducts_stock_ecuador(self, auth_headers, created_product):
        pid = created_product["id"]
        before = requests.get(f"{API}/inventory/products/{pid}", headers=auth_headers).json()
        stock_ec_before = before["stock_ecuador"]

        r = requests.post(
            f"{API}/inventory/sales",
            json={"product_id": pid, "quantity": 3, "location": "ecuador", "customer_id": "D1001"},
            headers=auth_headers,
        )
        assert r.status_code in (200, 201), r.text
        body = r.json()
        sale = body.get("sale", body)
        assert sale["quantity"] == 3
        assert sale["location"] == "ecuador"
        # profit = (sale_price - cost) * qty => (29.99 - 10) * 3
        assert round(sale["profit"], 2) == round((29.99 - 10.0) * 3, 2)

        after = requests.get(f"{API}/inventory/products/{pid}", headers=auth_headers).json()
        assert after["stock_ecuador"] == stock_ec_before - 3

    def test_create_sale_deducts_stock_usa(self, auth_headers, created_product):
        pid = created_product["id"]
        before = requests.get(f"{API}/inventory/products/{pid}", headers=auth_headers).json()
        stock_usa_before = before["stock_usa"]
        r = requests.post(
            f"{API}/inventory/sales",
            json={"product_id": pid, "quantity": 2, "location": "usa"},
            headers=auth_headers,
        )
        assert r.status_code in (200, 201), r.text
        after = requests.get(f"{API}/inventory/products/{pid}", headers=auth_headers).json()
        assert after["stock_usa"] == stock_usa_before - 2

    def test_create_sale_insufficient_stock(self, auth_headers, created_product):
        pid = created_product["id"]
        r = requests.post(
            f"{API}/inventory/sales",
            json={"product_id": pid, "quantity": 99999, "location": "ecuador"},
            headers=auth_headers,
        )
        assert r.status_code in (400, 409, 422), f"expected error, got {r.status_code}: {r.text}"

    def test_list_sales(self, auth_headers, created_product):
        r = requests.get(f"{API}/inventory/sales", headers=auth_headers)
        assert r.status_code == 200
        sales = r.json()
        assert isinstance(sales, list)
        assert any(s["product_id"] == created_product["id"] for s in sales)


class TestInventoryStockAdjust:
    def test_adjust_stock_positive(self, auth_headers, created_product):
        pid = created_product["id"]
        before = requests.get(f"{API}/inventory/products/{pid}", headers=auth_headers).json()
        r = requests.post(
            f"{API}/inventory/products/{pid}/adjust-stock",
            json={"adjustment": 5, "location": "ecuador", "reason": "TEST restock"},
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text
        after = requests.get(f"{API}/inventory/products/{pid}", headers=auth_headers).json()
        assert after["stock_ecuador"] == before["stock_ecuador"] + 5

    def test_adjust_stock_negative(self, auth_headers, created_product):
        pid = created_product["id"]
        before = requests.get(f"{API}/inventory/products/{pid}", headers=auth_headers).json()
        r = requests.post(
            f"{API}/inventory/products/{pid}/adjust-stock",
            json={"adjustment": -2, "location": "usa", "reason": "TEST merma"},
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text
        after = requests.get(f"{API}/inventory/products/{pid}", headers=auth_headers).json()
        assert after["stock_usa"] == before["stock_usa"] - 2


class TestInventoryStats:
    def test_stats_week(self, auth_headers, created_product):
        r = requests.get(f"{API}/inventory/stats?period=week", headers=auth_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        for key in ("period", "summary", "stock", "top_products", "low_stock_alerts", "daily_trend"):
            assert key in data, f"missing key {key}"
        s = data["summary"]
        for key in ("total_sales", "total_cost", "total_profit", "margin_percent", "total_quantity", "sale_count"):
            assert key in s
        # Sales done this week by this test should be reflected
        assert s["sale_count"] >= 2
        # top products should include our test product
        assert any(p["product_id"] == created_product["id"] for p in data["top_products"])

    def test_stats_month(self, auth_headers):
        r = requests.get(f"{API}/inventory/stats?period=month", headers=auth_headers)
        assert r.status_code == 200
        assert "summary" in r.json()

    def test_stats_all(self, auth_headers):
        r = requests.get(f"{API}/inventory/stats?period=all", headers=auth_headers)
        assert r.status_code == 200
        assert "summary" in r.json()

    def test_stats_week_offset(self, auth_headers):
        r = requests.get(f"{API}/inventory/stats?period=w1", headers=auth_headers)
        assert r.status_code == 200
        assert "summary" in r.json()

    def test_stats_stock_values(self, auth_headers, created_product):
        r = requests.get(f"{API}/inventory/stats?period=week", headers=auth_headers)
        data = r.json()
        stock = data["stock"]
        assert stock["ecuador"] >= 0
        assert stock["usa"] >= 0
        assert stock["product_count"] >= 1
        assert stock["total_value"] >= 0
