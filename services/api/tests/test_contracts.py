"""M12: contracts layer derived from the raw monitoring-visit mirror."""


def _by_kind(body: dict) -> dict:
    return {
        (f["properties"]["contractCode"], f["geometry"]["type"]): f
        for f in body["features"]
    }


def test_contracts_geojson(client):
    r = client.get("/api/contracts.geojson")
    assert r.status_code == 200
    body = r.json()
    assert body["type"] == "FeatureCollection"
    by_kind = _by_kind(body)

    # CTR-001: both visits (M1 completed, MF future) lack shapes, so the
    # geometry falls back to application A1's polygon; attributes come from
    # the latest completed visit.
    poly = by_kind[("CTR-001", "Polygon")]
    p = poly["properties"]
    assert p["applicationId"] == "A1"
    assert p["applicationCode"] == "APP-001"
    assert p["visitCount"] == 2
    assert p["visitsWithGeometry"] == 0
    assert p["selectedVisitRule"] == "latest_completed_visit"
    assert p["geometrySource"] == "application_shape_fallback"
    pt = by_kind[("CTR-001", "Point")]
    lon, lat = pt["geometry"]["coordinates"]
    assert abs(lon - 15.0067) < 0.01 and abs(lat + 0.9967) < 0.01  # centroid

    # CTR-002: its visit carries a shape of its own.
    poly2 = by_kind[("CTR-002", "Polygon")]
    p2 = poly2["properties"]
    assert p2["geometrySource"] == "monitoring_visit_shape"
    assert p2["visitsWithGeometry"] == 1
    assert p2["contractStatus"] == "Active"
    assert p2["startDate"] == "2024-09-01"
    assert p2["contractedAreaHa"] == 2.0
    assert poly2["geometry"]["type"] == "Polygon"
    assert ("CTR-002", "Point") in by_kind


def test_build_contracts_rules():
    from datetime import date

    from app.contracts import build_contracts

    visits = [
        # Two completed: the later one must supply the attributes.
        {"MonitoringVisitCode": "V1", "ContractCode": "C1", "ApplicationId": "X",
         "MonitoringDate": "2025-01-01", "ContractStatus": "Draft"},
        {"MonitoringVisitCode": "V2", "ContractCode": "C1", "ApplicationId": "X",
         "MonitoringDate": "2025-06-01", "ContractStatus": "Active"},
        # Future-only contract.
        {"MonitoringVisitCode": "V3", "ContractCode": "C2", "ApplicationId": "Y",
         "MonitoringDate": "2099-01-01"},
        # Undated-only contract, no application link: no geometry at all.
        {"MonitoringVisitCode": "V4", "ContractCode": "C3"},
        # No contract code: ignored.
        {"MonitoringVisitCode": "V5", "MonitoringDate": "2025-02-01"},
    ]
    parcels = {
        "X": {"application_code": "APP-X",
              "shape_raw": "POLYGON((0 0,0 1,1 1,0 0))", "point": None},
        "Y": {"application_code": "APP-Y", "shape_raw": None, "point": [9.0, -3.0]},
    }
    out = {c["contract_code"]: c for c in build_contracts(visits, parcels, date(2026, 1, 1))}
    assert set(out) == {"C1", "C2", "C3"}

    c1 = out["C1"]
    assert c1["status"] == "Active"  # latest completed visit wins
    assert c1["selected_visit_rule"] == "latest_completed_visit"
    assert c1["geometry_source"] == "application_shape_fallback"
    assert c1["visit_count"] == 2
    assert c1["point"] is not None  # polygon centroid

    c2 = out["C2"]
    assert c2["selected_visit_rule"] == "earliest_future_visit_no_completed_visit"
    assert c2["geometry_source"] == "no_polygon_available"
    assert c2["polygon"] is None
    assert c2["point"] == [9.0, -3.0]  # application point fallback

    c3 = out["C3"]
    assert c3["selected_visit_rule"] == "undated_visit_no_dated_visit"
    assert c3["polygon"] is None and c3["point"] is None
