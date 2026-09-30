"""POST /api/aoi (M3). These need the 005 PostGIS layer — the `postgis`
fixture skips the module's tests where the extension is unavailable."""


# Covers the COG seed polygons entirely (concession + its zoning serie),
# far from the retired/no_data COD ones.
AOI_COG = {
    "type": "Polygon",
    "coordinates": [[[14.9, -0.9], [14.9, -1.2], [15.2, -1.2], [15.2, -0.9], [14.9, -0.9]]],
}


def test_aoi_overlaps(client, postgis):
    r = client.post("/api/aoi", json={"geometry": AOI_COG})
    assert r.status_code == 200
    body = r.json()
    assert body["areaHa"] > 0
    uids = {o["srcUid"] for o in body["overlaps"]}
    # production filter: the retired and no_data concessions never appear
    assert uids == {"COG:conc:1", "COG:series:1"}
    conc = next(o for o in body["overlaps"] if o["srcUid"] == "COG:conc:1")
    assert conc["layer"] == "concessions"
    assert conc["name"] == "Ngombe"
    assert conc["docCount"] == 1
    assert 0 < conc["overlapHa"] <= body["areaHa"]
    assert 0 < conc["overlapPct"] <= 100
    # by_layer sums per layer
    assert set(body["byLayer"]) == {"concessions", "concession_zoning"}
    zoning = next(o for o in body["overlaps"] if o["srcUid"] == "COG:series:1")
    assert body["byLayer"]["concession_zoning"] == zoning["overlapHa"]


def test_aoi_no_overlap(client, postgis):
    away = {
        "type": "Polygon",
        "coordinates": [[[30, 5], [30, 5.1], [30.1, 5.1], [30, 5]]],
    }
    r = client.post("/api/aoi", json={"geometry": away})
    assert r.status_code == 200
    body = r.json()
    assert body["overlaps"] == []
    assert body["byLayer"] == {}


def test_aoi_partial_overlap_pct(client, postgis):
    # AOI = west half of the plane around the COG concession's bbox: the
    # overlap must be strictly smaller than the whole concession.
    half = {
        "type": "Polygon",
        "coordinates": [[[14.9, -0.9], [14.9, -1.2], [15.05, -1.2], [15.05, -0.9], [14.9, -0.9]]],
    }
    full = client.post("/api/aoi", json={"geometry": AOI_COG}).json()
    part = client.post("/api/aoi", json={"geometry": half}).json()
    conc_full = next(o for o in full["overlaps"] if o["srcUid"] == "COG:conc:1")
    conc_part = next(o for o in part["overlaps"] if o["srcUid"] == "COG:conc:1")
    assert conc_part["overlapHa"] < conc_full["overlapHa"]


def test_aoi_rejects_bad_type(client, postgis):
    r = client.post("/api/aoi", json={"geometry": {"type": "Point", "coordinates": [15, -1]}})
    assert r.status_code == 422


def test_aoi_rejects_invalid_geometry(client, postgis):
    r = client.post("/api/aoi", json={"geometry": {"type": "Polygon", "coordinates": "nope"}})
    assert r.status_code == 422


def test_aoi_rejects_oversize(client, postgis):
    # a ~40° box is far beyond the 5M-ha bound
    huge = {
        "type": "Polygon",
        "coordinates": [[[0, -20], [0, 20], [40, 20], [40, -20], [0, -20]]],
    }
    r = client.post("/api/aoi", json={"geometry": huge})
    assert r.status_code == 422
    assert "larger" in r.json()["detail"]
