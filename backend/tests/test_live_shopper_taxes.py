"""Backend tests for Live Shopping tax_amount (shopper tax) feature.

Spec:
- LiveModulePurchaseCreate accepts optional tax_amount (tax paid by personal shopper)
- Each purchase stores shopper_tax
- Live doc aggregates total_taxes_paid
- /api/stats returns total_shopper_taxes
- /api/admin/stats returns revenue.total_shopper_taxes and revenue.net_profit = commissions - shopper_taxes
- Formula from request: price 25, commission 5, tax 2.50 => net profit = 2.50
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = BASE_URL + "/api"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"identifier": email, "password": password})
    assert r.status_code == 200, f"login failed {email}: {r.status_code} {r.text}"
    j = r.json()
    return j.get("token") or j.get("access_token")


@pytest.fixture(scope="module")
def admin_token():
    return _login("admin@outletsusaec.com", "123456")


def _h(t):
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def live_id(admin_token):
    # Create a dedicated live (no tax rate so math is cleaner)
    payload = {
        "title": f"TEST_shopper_tax_{uuid.uuid4().hex[:6]}",
        "store": "TEST",
        "tax_rate": 0.0,
        "apply_tax": False,
    }
    r = requests.post(f"{API}/lives", headers=_h(admin_token), json=payload)
    assert r.status_code == 200, r.text
    live = r.json()
    lid = live.get("id") or live.get("live_id")
    assert lid
    return lid


@pytest.fixture(scope="module")
def customer_code(admin_token):
    # Try the context-provided existing client code first; fallback to J2934
    for code in ["M5358", "J2934"]:
        r = requests.get(f"{API}/wallet/by-customer/{code}", headers=_h(admin_token))
        if r.status_code == 200:
            return code
    pytest.skip("No usable test customer found for outletsusaec")


def test_live_purchase_with_tax_amount_persists_shopper_tax(admin_token, live_id, customer_code):
    item = f"TEST_TAX_{uuid.uuid4().hex[:5]}"
    payload = {
        "live_id": live_id,
        "item_name": item,
        "store": "TEST",
        "price": 25.0,
        "commission_amount": 5.0,
        "tax_amount": 2.50,
        "customer_ids": [customer_code],
    }
    r = requests.post(f"{API}/live-module/purchases", headers=_h(admin_token), json=payload)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("failed") == []
    assert len(data["created"]) == 1
    # Verify response surfaces shopper_tax
    assert data.get("shopper_tax") == 2.50, f"expected shopper_tax 2.50, got {data.get('shopper_tax')}"

    # Fetch the purchase and confirm shopper_tax is stored
    r = requests.get(f"{API}/purchases/live/{live_id}", headers=_h(admin_token))
    assert r.status_code == 200
    purchases = [p for p in r.json() if p.get("item_name") == item]
    assert purchases, "purchase not persisted"
    p = purchases[0]
    assert p.get("shopper_tax") == 2.50
    assert p.get("commission") == 5.0
    assert p.get("price") == 25.0

    # Fetch the live and confirm total_taxes_paid aggregated
    r = requests.get(f"{API}/lives/{live_id}", headers=_h(admin_token))
    assert r.status_code == 200
    liv = r.json()
    assert round(liv.get("total_taxes_paid") or 0, 2) >= 2.50, (
        f"total_taxes_paid not aggregated: {liv.get('total_taxes_paid')}"
    )
    # Commission - tax = net profit for this single sale slice => 5 - 2.50 = 2.50
    net = round((liv.get("total_commissions") or 0) - (liv.get("total_taxes_paid") or 0), 2)
    assert net >= 2.50 - 0.01


def test_live_purchase_without_tax_amount_defaults_zero(admin_token, live_id, customer_code):
    item = f"TEST_NOTAX_{uuid.uuid4().hex[:5]}"
    payload = {
        "live_id": live_id,
        "item_name": item,
        "price": 10.0,
        "commission_amount": 1.0,
        # tax_amount omitted
        "customer_ids": [customer_code],
    }
    r = requests.post(f"{API}/live-module/purchases", headers=_h(admin_token), json=payload)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("shopper_tax") == 0

    r = requests.get(f"{API}/purchases/live/{live_id}", headers=_h(admin_token))
    assert r.status_code == 200
    p = next(x for x in r.json() if x.get("item_name") == item)
    # shopper_tax defaults to 0 (either explicit 0 or missing)
    assert (p.get("shopper_tax") or 0) == 0


def test_admin_stats_includes_shopper_taxes_and_net_profit(admin_token):
    r = requests.get(f"{API}/admin/reports/business-stats?period=all", headers=_h(admin_token))
    assert r.status_code == 200, r.text
    data = r.json()
    rev = data.get("revenue", {})
    assert "total_shopper_taxes" in rev, f"missing total_shopper_taxes in revenue: {rev.keys()}"
    assert "net_profit" in rev, f"missing net_profit in revenue: {rev.keys()}"
    assert "total_commissions" in rev

    # Math: net_profit == total_commissions - total_shopper_taxes (rounded)
    expected_net = round(rev["total_commissions"] - rev["total_shopper_taxes"], 2)
    assert abs(rev["net_profit"] - expected_net) < 0.02, (
        f"net_profit {rev['net_profit']} != commissions {rev['total_commissions']} - taxes {rev['total_shopper_taxes']}"
    )
    # After our test purchase of 2.50, this must be > 0
    assert rev["total_shopper_taxes"] >= 2.50


def test_sales_by_live_includes_taxes_pagados(admin_token, live_id):
    r = requests.get(f"{API}/admin/reports/business-stats?period=all", headers=_h(admin_token))
    assert r.status_code == 200
    sales_by_live = r.json().get("sales_by_live", [])
    ours = next((l for l in sales_by_live if l.get("name", "").startswith("TEST_shopper_tax_")), None)
    assert ours is not None, "test live not in sales_by_live"
    assert "taxes_pagados" in ours
    assert ours["taxes_pagados"] >= 2.50


def test_stats_endpoint_includes_total_shopper_taxes(admin_token):
    r = requests.get(f"{API}/admin/reports/summary?period=all", headers=_h(admin_token))
    assert r.status_code == 200, r.text
    data = r.json()
    assert "total_shopper_taxes" in data, f"missing total_shopper_taxes in /stats: {list(data.keys())}"
    assert data["total_shopper_taxes"] >= 2.50
