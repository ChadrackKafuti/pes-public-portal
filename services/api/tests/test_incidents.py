"""Incident feed endpoints (M23)."""


def test_incident_list_and_summary(client):
    r = client.get("/api/incidents")
    assert r.status_code == 200
    data = r.json()
    uids = [i["incidentUid"] for i in data["items"]]
    # A6 belongs to the hidden QA org — its incident never surfaces.
    assert "A6:fire:2026-09-25" not in uids
    assert "A1:fire:2026-09-20" in uids
    # Open incidents sort first.
    assert data["items"][0]["status"] == "open"
    assert data["summary"]["open"] == 1
    assert data["summary"]["responded"] == 1
    assert data["summary"]["resolved"] == 1
    row = next(i for i in data["items"] if i["incidentUid"] == "A1:fire:2026-09-20")
    assert row["applicationCode"] == "APP-001"
    assert row["kind"] == "fire" and row["magnitude"] == 3


def test_incident_filters(client):
    only_fire = client.get("/api/incidents", params={"kind": "fire"}).json()["items"]
    assert {i["kind"] for i in only_fire} == {"fire"}
    only_open = client.get("/api/incidents", params={"status": "open"}).json()["items"]
    assert {i["status"] for i in only_open} == {"open"}
    assert client.get("/api/incidents", params={"kind": "nope"}).status_code == 422


def test_incident_status_workflow(client):
    uid = "A1:fire:2026-09-20"
    # open -> responded
    r = client.patch(f"/api/incidents/{uid}", json={"status": "responded", "note": "team sent"})
    assert r.status_code == 200
    assert r.json()["status"] == "responded"
    assert r.json()["statusNote"] == "team sent"
    # responded -> responded is not a legal transition
    assert client.patch(f"/api/incidents/{uid}", json={"status": "responded"}).status_code == 409
    # responded -> verified, then reopen
    assert client.patch(f"/api/incidents/{uid}", json={"status": "verified"}).status_code == 200
    assert client.patch(f"/api/incidents/{uid}", json={"status": "open"}).status_code == 200
    # unknown incident
    assert client.patch("/api/incidents/NOPE", json={"status": "responded"}).status_code == 404
