"""M20: admin follow-up of skipped/failed parcels."""


def test_admin_exceptions_grouped_and_hidden_excluded(client):
    r = client.get("/api/admin/exceptions")
    assert r.status_code == 200
    body = r.json()
    summary = {s["reason"]: s["objects"] for s in body["summary"]}
    # A2 oversize (2 occurrences, 1 object); A4 geometry; A6 (QA org) excluded
    assert summary["oversize_gt_5000ha"] == 1
    assert summary["no_usable_geometry"] == 1
    by_id = {(i["objectId"], i["reason"]): i for i in body["items"]}
    a2 = by_id[("A2", "oversize_gt_5000ha")]
    assert a2["occurrences"] == 2
    assert a2["applicationCode"] == "APP-002"
    assert a2["areaGis"] == 6200
    assert ("A6", "no_usable_geometry") not in by_id
