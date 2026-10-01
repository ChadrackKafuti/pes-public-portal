"""Governance feature detail endpoint (M7c). Seeds: conftest GOV_SEED."""


def test_detail_parent_with_zones(client):
    r = client.get("/api/governance/features/COG:conc:1")
    assert r.status_code == 200
    d = r.json()
    assert d["layer"] == "concessions"
    assert d["name"] == "Ngombe"
    assert d["subTypeStd"] == "ufa"
    assert d["statusStd"] == "attributed"
    assert d["areaCalcHa"] == 12000.0
    # extras merge intact, src json absent → no srcAttrs key
    assert d["extras"]["cert_type"] == "FSC"
    assert "srcAttrs" not in d
    # zoning children
    assert len(d["zones"]) == 1
    z = d["zones"][0]
    assert z["srcUid"] == "COG:series:1"
    assert z["zoneTypeStd"] == "production"
    assert z["areaCalcHa"] == 400.0


def test_detail_zone_has_parent_card(client):
    r = client.get("/api/governance/features/COG:series:1")
    assert r.status_code == 200
    d = r.json()
    assert d["layer"] == "concession_zoning"
    assert d["parent"]["srcUid"] == "COG:conc:1"
    assert d["parent"]["name"] == "Ngombe"
    assert d["siblingCount"] == 1
    assert d["siblingAreaHa"] == 400.0


def test_detail_unknown_404(client):
    assert client.get("/api/governance/features/NOPE").status_code == 404
