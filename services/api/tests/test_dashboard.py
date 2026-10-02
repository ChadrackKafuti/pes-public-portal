"""Dashboard aggregates against the seeded test database (3 parcels: 2 DRC,
1 ROC; A1 has an application object + one visit; 4 governance areas of
which 2 pass the production filter; 1 document)."""


def test_dashboard_totals_and_groups(client):
    d = client.get("/api/dashboard").json()
    pes = d["pes"]
    assert pes["applications"] == 3
    assert pes["visits"] == 1
    # A1 has parcel_area 3.4 (object), A2/A4 fall back to estimated 2.0/1.0
    assert pes["parcelAreaHa"] == 6.4
    assert pes["treeCoverHa"] == 2.1
    assert pes["statusCounts"] == {"ok": 1, "partial": 0, "partialFinal": 0}
    by_country = {g["name"]: g for g in pes["byCountry"]}
    assert by_country["DRC"]["applications"] == 2
    assert by_country["ROC"]["applications"] == 1
    assert len(pes["byMonth"]) == 3  # Jun, Jul, Aug 2024
    assert pes["byMonth"][0] == {"month": "2024-06", "applications": 1}

    gov = d["governance"]
    by_layer = {g["layer"]: g for g in gov["byLayer"]}
    assert len(by_layer) == 7  # every layer listed, zeros included
    assert by_layer["concessions"]["count"] == 1        # production filter applied
    assert by_layer["concession_zoning"]["count"] == 1
    assert by_layer["protected_areas"]["count"] == 0
    assert gov["documents"] == 1


def test_dashboard_profile_aggregates(client):
    """M7e: v1 country-overview figures from the raw payload mirror (only A1
    has a raw record: stage Validated/5, gender Female, no overdue flag,
    no burned area -> empty fire profile)."""
    pes = client.get("/api/dashboard").json()["pes"]
    assert pes["byStage"] == [{"name": "Validated", "order": 5, "applications": 1}]
    assert pes["byGender"] == [{"name": "Female", "applications": 1}]
    assert pes["fireProfile"] == []
    assert pes["overdue"] == 0


def test_dashboard_country_filter(client):
    d = client.get("/api/dashboard", params={"country": "ROC"}).json()
    pes = d["pes"]
    assert pes["applications"] == 1
    assert pes["visits"] == 0
    assert pes["treeCoverHa"] is None  # blank is not zero
    assert [g["name"] for g in pes["byCountry"]] == ["ROC"]
    # no raw records for ROC applications -> profile aggregates stay empty
    assert pes["byStage"] == []
    assert pes["overdue"] is None
    # governance stays basin-wide (iso3-keyed, not narrowed by PES country names)
    assert d["governance"]["documents"] == 1
