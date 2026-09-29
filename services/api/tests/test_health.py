def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_run_health(client):
    r = client.get("/api/health/runs")
    assert r.status_code == 200
    runs = r.json()
    assert len(runs) == 1
    assert runs[0]["stoppedReason"] == "completed"
    assert runs[0]["fetchedApp"] == 2
