"""M20: hidden records never enter computation."""

from pes_rs_pipeline.visibility import (
    application_hidden,
    split_visible,
    visit_hidden,
)


def test_application_hidden_rules():
    assert application_hidden({"Stage": "Archived"})
    assert application_hidden({"IsDeleted": "true"})
    assert application_hidden({"Stage": "Rejected"})
    assert application_hidden({"Stage": "Not Validated", "StageOrder": -5})
    assert application_hidden({"StageOrder": -7})
    assert application_hidden({"ImplementingOrgName": "XeptagonQATestProject"})
    assert not application_hidden({"Stage": "Validated", "StageOrder": 5})


def test_visit_hidden_rules():
    assert visit_hidden({"IsDeleted": True})
    assert visit_hidden({"MonitoringVisitStatus": "Supprimé"})
    assert not visit_hidden({"MonitoringVisitStatus": "Completed"})


def test_split_visible_drops_hidden_families():
    apps = [
        {"ApplicationId": "A1", "Stage": "Validated", "ApplicationDate": "2024-01-01"},
        {"ApplicationId": "A2", "Stage": "Rejected", "ApplicationDate": "2024-01-01"},
    ]
    visits = [
        {"MonitoringVisitCode": "V1", "ApplicationId": "A1"},
        {"MonitoringVisitCode": "V2", "ApplicationId": "A2"},  # hidden parent
        {"MonitoringVisitCode": "V3", "ApplicationId": "A1", "IsDeleted": 1},
    ]
    va, vv, hidden = split_visible(apps, visits)
    assert [a["ApplicationId"] for a in va] == ["A1"]
    assert [v["MonitoringVisitCode"] for v in vv] == ["V1"]
    assert hidden == {"A2"}


def test_structured_output_schemas_use_supported_subset():
    """The structured-outputs API rejects type arrays and numeric/string
    constraints — guard every vision schema against reintroducing them
    (this exact mistake 400'd all photo analyses once)."""
    import json

    from pes_rs_pipeline.photos_ai import _SCHEMA as photo_schema
    from pes_rs_pipeline.roads import _SCHEMA as road_schema

    banned_keys = {"minimum", "maximum", "minLength", "maxLength", "multipleOf"}

    def walk(node):
        if isinstance(node, dict):
            assert not (banned_keys & node.keys()), node
            if "type" in node:
                assert isinstance(node["type"], str), node
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    for schema in (photo_schema, road_schema):
        walk(json.loads(json.dumps(schema)))
