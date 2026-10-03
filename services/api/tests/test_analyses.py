"""Contract analyses endpoints (M7d)."""


def test_contract_picker_list(client):
    r = client.get("/api/analyses/contracts")
    assert r.status_code == 200
    rows = r.json()
    codes = [c["contractCode"] for c in rows]
    assert "CTR-001" in codes
    c = next(x for x in rows if x["contractCode"] == "CTR-001")
    assert c["org"] == "Org A" and c["project"] == "Project X"
    assert c["applications"] == 1
    # M21 — A1 carries annual rows, so its contract is flagged ready
    assert c["hasSeries"] is True
    c2 = next(x for x in rows if x["contractCode"] == "CTR-002")
    assert c2["hasSeries"] is False


def test_contract_analysis_series_and_meta(client):
    r = client.get("/api/analyses/contracts/CTR-001")
    assert r.status_code == 200
    a = r.json()
    assert a["contractCode"] == "CTR-001"
    assert a["activity"] == "Agroforestry"
    # raw-payload description fields
    assert a["beneficiaryType"] == "Individual farmer"
    assert a["contractedAreaHa"] == 3.0
    assert a["startDate"] == "2024-07-01"
    # the annual series, ordered
    years = [p["year"] for p in a["series"]]
    assert years == [2022, 2023, 2024, 2025]
    assert a["series"][-1]["tcHa"] == 2.1
    assert a["series"][1]["lossHa"] == 0.2
    # parcel area from the RS application row
    assert a["parcelAreaHa"] == 3.4


def test_contract_analysis_unknown_404(client):
    assert client.get("/api/analyses/contracts/NOPE").status_code == 404


def test_visit_derived_contract_linkage(client):
    """M13: production applications carry no ContractCode — A2's link to
    CTR-002 exists only on its monitoring visit, and the contract fields come
    from that visit's payload."""
    r = client.get("/api/analyses/contracts")
    codes = [c["contractCode"] for c in r.json()]
    assert "CTR-002" in codes
    c = next(x for x in r.json() if x["contractCode"] == "CTR-002")
    assert c["applications"] == 1

    a = client.get("/api/analyses/contracts/CTR-002").json()
    assert a["applications"] == 1
    assert a["contractedAreaHa"] == 2.0
    assert a["startDate"] == "2024-09-01"
