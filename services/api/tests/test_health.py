from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_contracts_stub():
    r = client.get("/api/contracts")
    assert r.status_code == 200
    assert r.json() == {"items": [], "total": 0}


def test_indicators_not_implemented_yet():
    assert client.get("/api/contracts/X/indicators").status_code == 501
