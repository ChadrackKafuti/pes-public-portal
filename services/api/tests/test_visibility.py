"""M14: archived/deleted records never reach the frontend.

Seeds: A5 is an archived application (parcel + raw payload with Stage
"Archived"); MD is a deleted monitoring visit on CTR-001 (IsDeleted true,
later than M1); MA carries contract CTR-003 with ContractStatus "Archived".
"""


def test_archived_application_filtered_everywhere(client):
    # list endpoint: A5 never appears, totals unchanged
    body = client.get("/api/applications").json()
    assert body["total"] == 3
    assert all(i["applicationId"] != "A5" for i in body["items"])
    # geojson: no A5 features, despite its polygon
    gj = client.get("/api/applications.geojson").json()
    assert all(f["properties"]["applicationId"] != "A5" for f in gj["features"])
    # photos: nothing served for A5 (none seeded, but the route filters too)
    pj = client.get("/api/photos.geojson").json()
    assert all(f["properties"]["applicationId"] != "A5" for f in pj["features"])
    # dashboard: totals and gender split exclude the archived record
    d = client.get("/api/dashboard").json()["pes"]
    assert d["applications"] == 3
    assert all(s["name"] != "Archived" for s in d["byStage"])


def test_deleted_visit_ignored(client):
    # MD (deleted, 2025-07-01) must not displace M1 as CTR-001's base visit
    gj = client.get("/api/contracts.geojson").json()
    c1 = next(
        f["properties"]
        for f in gj["features"]
        if f["properties"]["contractCode"] == "CTR-001"
    )
    assert c1["visitCount"] == 2  # M1 + MF, MD excluded
    # profile visit schedule ignores it too
    v = client.get("/api/applications/A1/profile").json()["visits"]
    assert v["completed"] == 1 and v["lastDate"] == "2025-03-15"


def test_archived_contract_filtered(client):
    gj = client.get("/api/contracts.geojson").json()
    assert all(f["properties"]["contractCode"] != "CTR-003" for f in gj["features"])
    codes = [c["contractCode"] for c in client.get("/api/analyses/contracts").json()]
    assert "CTR-003" not in codes and "CTR-001" in codes and "CTR-002" in codes


def test_qa_organisation_filtered(client):
    """M18: the QA tenant's records (A6, no raw payload — the parcel columns
    carry the org) never reach the frontend."""
    body = client.get("/api/applications").json()
    assert body["total"] == 3
    assert all(i["applicationId"] != "A6" for i in body["items"])
    gj = client.get("/api/applications.geojson").json()
    assert all(f["properties"]["applicationId"] != "A6" for f in gj["features"])
    opts = client.get("/api/filters").json()
    assert "XeptagonQATestProject" not in opts["organisations"]
    assert "Equateur" not in opts["provinces"]  # only the QA record had it
    d = client.get("/api/dashboard").json()["pes"]
    assert d["applications"] == 3


def test_helpers():
    from app.visibility import application_hidden, contract_hidden, visit_hidden

    assert application_hidden({"Stage": "Archived"})
    assert application_hidden({"IsDeleted": "true"})
    assert application_hidden({"ApplicationStatus": "Supprimé"})
    assert not application_hidden({"Stage": "Rejected"})  # rejected stays visible
    assert not application_hidden({"Stage": "Validated"})
    assert visit_hidden({"IsDeleted": True})
    assert not visit_hidden({"MonitoringVisitStatus": "Completed"})
    assert contract_hidden({"ContractStatus": "Archived"})
    assert not contract_hidden({"ContractStatus": "Cancelled"})
    assert application_hidden({"ImplementingOrgName": "XeptagonQATestProject"})
    assert application_hidden({"ProjectName": " xeptagonqatestproject "})
    assert not application_hidden({"ImplementingOrgName": "Org A"})