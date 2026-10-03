"""Geotagged photo endpoints (M7a). Seed: four photos in conftest.PHOTO_SEED
(dddd4444 has no GPS and falls back to its parcel's centroid)."""


def test_photos_geojson_all(client):
    r = client.get("/api/photos.geojson")
    assert r.status_code == 200
    body = r.json()
    assert body["type"] == "FeatureCollection"
    uids = {f["properties"]["photoUid"] for f in body["features"]}
    assert uids == {"aaaa1111", "bbbb2222", "cccc3333", "dddd4444"}
    # no-GPS photo lands on its application polygon's centroid (M10)
    nogps = next(f for f in body["features"] if f["properties"]["photoUid"] == "dddd4444")
    lon, lat = nogps["geometry"]["coordinates"]
    assert abs(lon - 15.0067) < 0.01 and abs(lat - (-0.9967)) < 0.01
    first = next(f for f in body["features"] if f["properties"]["photoUid"] == "aaaa1111")
    assert first["geometry"]["coordinates"] == [15.002, -0.998]
    assert first["properties"]["mirrored"] is True
    assert first["properties"]["label"] == "Parcel north edge"
    # expiring source URLs are never exposed
    assert "url" not in first["properties"]


def test_photos_geojson_filters(client):
    r = client.get("/api/photos.geojson", params={"application": "A1"})
    uids = {f["properties"]["photoUid"] for f in r.json()["features"]}
    assert uids == {"aaaa1111", "bbbb2222", "dddd4444"}
    r = client.get("/api/photos.geojson", params={"application": "A1", "kind": "application"})
    uids = {f["properties"]["photoUid"] for f in r.json()["features"]}
    assert uids == {"aaaa1111", "dddd4444"}


def test_application_photos_list(client):
    r = client.get("/api/applications/A1/photos")
    assert r.status_code == 200
    rows = r.json()
    assert [p["photoUid"] for p in rows] == ["aaaa1111", "dddd4444", "bbbb2222"]
    assert rows[0]["mirrored"] is True and rows[1]["mirrored"] is False


def test_image_url_unconfigured_storage(client):
    # test settings have no service key: a mirrored photo reports 503,
    # an unmirrored one 404 either way
    r = client.get("/api/photos/aaaa1111/image-url")
    assert r.status_code == 503
    r = client.get("/api/photos/bbbb2222/image-url")
    assert r.status_code == 404


def test_photo_ai_fields_surface(client):
    """M26: the AI reading rides the photo endpoints once computed."""
    rows = client.get("/api/applications/A1/photos").json()
    seen = next(p for p in rows if p["photoUid"] == "aaaa1111")
    assert seen["aiScene"] == "saplings_plantation"
    assert seen["aiConsistent"] is True and seen["aiTreeCount"] == 24
    assert "acacia" in seen["aiSummary"].lower()
    unseen = next(p for p in rows if p["photoUid"] == "bbbb2222")
    assert unseen["aiScene"] is None and unseen["aiSummary"] is None

    gj = client.get("/api/photos.geojson", params={"application": "A1"}).json()
    props = next(
        f["properties"] for f in gj["features"]
        if f["properties"]["photoUid"] == "aaaa1111"
    )
    assert props["aiScene"] == "saplings_plantation"
    assert props["aiSummary"].startswith("Rows of young")
