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
