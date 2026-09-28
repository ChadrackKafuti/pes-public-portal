"""Governance endpoints: layer registry, GeoJSON with the production filter,
documents route."""


def test_layers_registry_counts_production_rows_only(client):
    r = client.get("/api/governance/layers")
    assert r.status_code == 200
    by_layer = {row["layer"]: row for row in r.json()}
    assert len(by_layer) == 7
    # retired and no_data rows are excluded from the counts
    assert by_layer["concessions"]["total"] == 1
    assert by_layer["concessions"]["byCountry"] == {"COG": 1}
    assert by_layer["concession_zoning"]["total"] == 1
    assert by_layer["protected_areas"]["total"] == 0


def test_geojson_default_filter(client):
    r = client.get("/api/governance/concessions.geojson")
    assert r.status_code == 200
    fc = r.json()
    uids = [f["properties"]["srcUid"] for f in fc["features"]]
    assert uids == ["COG:conc:1"]  # retired + no_data rows dropped
    props = fc["features"][0]["properties"]
    assert props["subTypeStd"] == "ufa"
    assert props["certType"] == "FSC"           # extras merged, camelCased
    assert fc["features"][0]["geometry"]["type"] == "Polygon"


def test_geojson_all_and_country_params(client):
    r = client.get("/api/governance/concessions.geojson", params={"all": "true"})
    assert len(r.json()["features"]) == 3
    r = client.get("/api/governance/concessions.geojson", params={"all": "true", "country": "cod"})
    uids = {f["properties"]["srcUid"] for f in r.json()["features"]}
    assert uids == {"COD:conc:9", "COD:conc:10"}


def test_geojson_unknown_layer_404(client):
    assert client.get("/api/governance/nope.geojson").status_code == 404


def test_zoning_carries_parent_and_zone_type(client):
    r = client.get("/api/governance/concession_zoning.geojson")
    props = r.json()["features"][0]["properties"]
    assert props["parentUid"] == "COG:conc:1"
    assert props["zoneTypeStd"] == "production"
    assert props["parentName"] == "Ngombe"


def test_documents_route(client):
    r = client.get("/api/governance/features/COG:conc:1/documents")
    assert r.status_code == 200
    docs = r.json()
    assert len(docs) == 1
    assert docs[0]["categoryStd"] == "management_plan"
    assert docs[0]["url"].startswith("https://")
    # known feature without documents -> empty list, unknown -> 404
    assert client.get("/api/governance/features/COG:series:1/documents").json() == []
    assert client.get("/api/governance/features/NOPE/documents").status_code == 404
