def test_filter_options(client):
    opts = client.get("/api/filters").json()
    assert opts["countries"] == ["DRC", "ROC"]
    assert opts["provinces"] == ["Kinshasa", "Kongo-Central", "Sangha"]
    assert opts["organisations"] == ["Org A", "Org B"]
    assert opts["projects"] == ["Project X", "Project Y"]
    assert "Agroforestry" in opts["activities"]


def test_provinces_narrow_by_country(client):
    opts = client.get("/api/filters", params={"country": "DRC"}).json()
    assert opts["provinces"] == ["Kinshasa", "Kongo-Central"]


def test_list_filters_by_location_and_org(client):
    assert client.get("/api/applications", params={"country": "DRC"}).json()["total"] == 2
    assert client.get("/api/applications", params={"province": "Sangha"}).json()["total"] == 1
    assert client.get("/api/applications", params={"org": "Org A"}).json()["total"] == 2
    both = client.get(
        "/api/applications", params={"org": "Org A", "country": "DRC"}
    ).json()
    assert both["total"] == 1 and both["items"][0]["country"] == "DRC"
    assert client.get("/api/applications", params={"project": "Project Y"}).json()["total"] == 1


def test_summary_carries_attributes(client):
    items = client.get("/api/applications").json()["items"]
    a1 = next(i for i in items if i["applicationId"] == "A1")
    assert (a1["country"], a1["province"]) == ("DRC", "Kongo-Central")
    assert (a1["implementingOrg"], a1["projectName"]) == ("Org A", "Project X")
