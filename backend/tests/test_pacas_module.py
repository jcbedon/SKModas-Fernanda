"""Tests for Pacas module: CRUD, sales, stats."""
import os
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"identifier": "admin@outletsusaec.com", "password": "123456"}
CLIENT_CUSTOMER_ID = "J2934"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json=ADMIN, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="module")
def created_paca(auth_headers):
    payload = {
        "name": "TEST_Paca_Maquillaje",
        "description": "Paca de prueba automatizada",
        "sale_price": 250.0,
        "commission": 55.0,
    }
    r = requests.post(f"{API}/pacas", json=payload, headers=auth_headers, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "id" in data
    yield {"id": data["id"], **payload}
    # Cleanup
    requests.delete(f"{API}/pacas/{data['id']}", headers=auth_headers, timeout=30)


# =============== CRUD ===============

def test_list_pacas(auth_headers):
    r = requests.get(f"{API}/pacas", headers=auth_headers, timeout=30)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_create_paca_persists(auth_headers, created_paca):
    r = requests.get(f"{API}/pacas/{created_paca['id']}", headers=auth_headers, timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == created_paca["name"]
    assert data["sale_price"] == 250.0
    assert data["commission"] == 55.0
    assert data["status"] == "active"
    assert "_id" not in data


def test_update_paca(auth_headers, created_paca):
    r = requests.put(
        f"{API}/pacas/{created_paca['id']}",
        json={"sale_price": 260.0, "commission": 60.0},
        headers=auth_headers,
        timeout=30,
    )
    assert r.status_code == 200
    g = requests.get(f"{API}/pacas/{created_paca['id']}", headers=auth_headers, timeout=30).json()
    assert g["sale_price"] == 260.0
    assert g["commission"] == 60.0


def test_get_nonexistent_paca_returns_404(auth_headers):
    r = requests.get(f"{API}/pacas/nonexistent-id-xyz", headers=auth_headers, timeout=30)
    assert r.status_code == 404


def test_unauthorized_access(auth_headers):
    r = requests.get(f"{API}/pacas", timeout=30)
    assert r.status_code in (401, 422)


# =============== Sales ===============

def test_create_paca_sale_invalid_customer(auth_headers, created_paca):
    r = requests.post(
        f"{API}/pacas/sales",
        json={"paca_id": created_paca["id"], "customer_id": "NONEXISTENT999"},
        headers=auth_headers,
        timeout=30,
    )
    assert r.status_code == 404
    assert "Cliente" in r.json().get("detail", "")


def test_create_paca_sale_success_and_purchase(auth_headers, created_paca):
    r = requests.post(
        f"{API}/pacas/sales",
        json={"paca_id": created_paca["id"], "customer_id": CLIENT_CUSTOMER_ID},
        headers=auth_headers,
        timeout=30,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert "sale_id" in data
    assert "purchase_id" in data
    assert data.get("client_name")

    # Verify sale appears in list
    sl = requests.get(f"{API}/pacas/sales/list?period=week", headers=auth_headers, timeout=30)
    assert sl.status_code == 200
    sales = sl.json()
    assert any(s["id"] == data["sale_id"] for s in sales)
    sale = next(s for s in sales if s["id"] == data["sale_id"])
    assert sale["customer_id"] == CLIENT_CUSTOMER_ID
    assert sale["paca_name"] == created_paca["name"]
    assert "_id" not in sale


def test_create_paca_sale_invalid_paca(auth_headers):
    r = requests.post(
        f"{API}/pacas/sales",
        json={"paca_id": "fake-paca-id", "customer_id": CLIENT_CUSTOMER_ID},
        headers=auth_headers,
        timeout=30,
    )
    assert r.status_code == 404


# =============== Stats ===============

def test_paca_stats_structure(auth_headers):
    r = requests.get(f"{API}/pacas/stats?period=month", headers=auth_headers, timeout=30)
    assert r.status_code == 200
    data = r.json()
    for key in ["total_sales", "total_commission", "total_count", "avg_sale",
                "avg_commission", "by_paca", "daily_trend"]:
        assert key in data, f"Missing key {key}"
    assert isinstance(data["by_paca"], list)
    assert isinstance(data["daily_trend"], list)


def test_paca_stats_period_all(auth_headers):
    r = requests.get(f"{API}/pacas/stats?period=all", headers=auth_headers, timeout=30)
    assert r.status_code == 200
    assert r.json()["total_count"] >= 0


# =============== Delete ===============

def test_delete_paca(auth_headers):
    # Create a dedicated paca
    r = requests.post(
        f"{API}/pacas",
        json={"name": "TEST_Paca_Delete", "sale_price": 100, "commission": 50},
        headers=auth_headers,
        timeout=30,
    )
    pid = r.json()["id"]
    d = requests.delete(f"{API}/pacas/{pid}", headers=auth_headers, timeout=30)
    assert d.status_code == 200
    g = requests.get(f"{API}/pacas/{pid}", headers=auth_headers, timeout=30)
    assert g.status_code == 404
