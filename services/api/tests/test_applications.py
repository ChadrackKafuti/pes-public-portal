def test_list_applications(client):
    r = client.get("/api/applications")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 3
    by_id = {item["applicationId"]: item for item in body["items"]}

    a1 = by_id["A1"]
    assert a1["pesActivity"] == "Agroforestry"
    assert a1["treeCoverHa"] == 2.1
    assert a1["visitCount"] == 1
    assert a1["status"] == "ok"

    # A2 exists in the parcel cache but has no indicator row yet:
    # listed, with blank (null, not zero) indicator fields.
    a2 = by_id["A2"]
    assert a2["treeCoverHa"] is None
    assert a2["parcelAreaHa"] is None
    assert a2["visitCount"] == 0


def test_filters_and_search(client):
    assert [
        i["applicationId"]
        for i in client.get("/api/applications", params={"activity": "Reforestation"}).json()["items"]
    ] == ["A2"]
    assert client.get("/api/applications", params={"status": "ok"}).json()["total"] == 1
    assert client.get("/api/applications", params={"q": "a1"}).json()["total"] == 1  # ILIKE
    assert client.get("/api/applications", params={"q": "zzz"}).json()["total"] == 0


def test_family_indicators_timeline(client):
    r = client.get("/api/applications/A1/indicators")
    assert r.status_code == 200
    rows = r.json()
    assert [row["objectId"] for row in rows] == ["A1", "M1"]  # oldest first

    app_row, visit_row = rows
    assert app_row["objectType"] == "application"
    assert app_row["currentStart"] is None  # blank for applications (spec §7)
    assert visit_row["objectType"] == "monitoring_visit"
    assert visit_row["status"] == "partial"
    assert visit_row["failedIndicators"] == ["fire_alerts"]
    assert visit_row["fireAlerts5yr"] is None  # blank, not zero


def test_known_application_without_rows_is_empty_list(client):
    r = client.get("/api/applications/A2/indicators")
    assert r.status_code == 200
    assert r.json() == []


def test_unknown_application_404(client):
    assert client.get("/api/applications/NOPE/indicators").status_code == 404


def test_contract_dossier(client):
    rows = client.get("/api/contracts/CTR-001/indicators").json()
    assert [r["objectId"] for r in rows] == ["A1", "M1"]
    assert all(r["contractCode"] == "CTR-001" for r in rows)
    assert client.get("/api/contracts/NOPE/indicators").status_code == 404


def test_codes_in_listing_and_search(client):
    items = client.get("/api/applications").json()["items"]
    a1 = next(i for i in items if i["applicationId"] == "A1")
    assert (a1["applicationCode"], a1["contractCode"]) == ("APP-001", "CTR-001")
    assert client.get("/api/applications", params={"q": "ctr-001"}).json()["total"] == 1


def test_geojson_features(client):
    fc = client.get("/api/applications.geojson").json()
    assert fc["type"] == "FeatureCollection"
    by_id = {f["properties"]["applicationId"]: f for f in fc["features"]}

    # A1: WKT polygon parsed server-side, with joined indicator properties.
    a1 = by_id["A1"]
    assert a1["geometry"]["type"] == "Polygon"
    assert a1["properties"]["contractCode"] == "CTR-001"
    assert a1["properties"]["status"] == "ok"
    assert a1["properties"]["treeCoverHa"] == 2.1
    # M7e filter properties: parcel columns + raw payload fields
    assert a1["properties"]["country"] == "DRC"
    assert a1["properties"]["beneficiaryType"] == "Individual farmer"
    assert a1["properties"]["gender"] == "Female"
    assert a1["properties"]["applicationStatus"] == "In progress"

    # A2: no shape -> point fallback; unprocessed -> null indicator props.
    a2 = by_id["A2"]
    assert a2["geometry"] == {"type": "Point", "coordinates": [15.5, -2.25]}
    assert a2["properties"]["status"] is None

    # A4 has neither shape nor point -> omitted.
    assert "A4" not in by_id
