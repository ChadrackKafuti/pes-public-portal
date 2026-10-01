"""Application profile endpoint (M7b). Seeds: conftest RAW_SEED + SEED."""


def test_profile_full_assembly(client):
    r = client.get("/api/applications/A1/profile")
    assert r.status_code == 200
    p = r.json()
    assert p["applicationCode"] == "APP-001"
    assert p["activityGroup"] == "agroforestry"
    # stage tracker
    assert p["stage"]["name"] == "Validated"
    assert p["stage"]["order"] == 5 and p["stage"]["total"] == 7
    assert p["stage"]["category"] == "active"
    # beneficiary + project + aggregator parse
    assert p["beneficiary"]["gender"] == "Female"
    assert p["beneficiary"]["dependents"] == 4
    assert p["project"]["orgAcronym"] == "OA"
    assert p["project"]["aggregator"] == "Green Coop (GC)"
    # contract timeline
    c = p["contract"]
    assert c["code"] == "CTR-001" and c["status"] == "Active"
    assert c["declaredAreaHa"] == 3.2
    assert c["contractedAreaHa"] == 3.0
    assert 0 < c["pctElapsed"] < 100
    assert c["daysRemaining"] > 0
    assert [s["name"] for s in c["species"]] == ["Acacia", "Moringa"]
    assert c["species"][0]["densityPerHa"] == 400
    # visits: M1 done, MF future
    v = p["visits"]
    assert v["expected"] == 6  # declared VisitCount wins
    assert v["completed"] == 1
    assert v["lastDate"] == "2025-03-15"
    assert v["nextDue"] == "2099-04-01"
    # performance from latest visit payload
    perf = p["performance"]
    assert perf["achievedHa"] == 2.1 and perf["gapHa"] == 0.9
    assert perf["achievedPct"] == 70.0
    assert perf["observedTrees"] == 820
    # areas comparison
    assert p["areas"]["estimatedHa"] == 3.5
    assert p["areas"]["achievedHa"] == 2.1
    # fire card from RS rows (seed has no burned area → None figures, no category)
    assert p["fire"] is not None
    assert p["geometrySource"] in ("polygon", "polygon_inherited")


def test_profile_parcel_only_fallback(client):
    # A2 has a parcel row but no raw payload: profile still answers.
    r = client.get("/api/applications/A2/profile")
    assert r.status_code == 200
    p = r.json()
    assert p["applicationCode"] == "APP-002"
    assert p["stage"] is None
    assert p["beneficiary"] is None
    assert p["location"]["country"] == "DRC"


def test_profile_unknown_404(client):
    assert client.get("/api/applications/NOPE/profile").status_code == 404
