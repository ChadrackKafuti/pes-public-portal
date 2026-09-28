import json
from datetime import date

import httpx
import pytest

from pes_rs_pipeline.config import PipelineConfig
from pes_rs_pipeline.models import ObjectType
from pes_rs_pipeline.pes_api import (
    PAGE_SIZE,
    PesApiClient,
    normalize_application,
    normalize_visit,
)


def _config() -> PipelineConfig:
    return PipelineConfig(
        pes_api_base="https://pes.example",
        pes_oidc_token_url="https://sso.example/token",
    )


def _client(monkeypatch, handler) -> PesApiClient:
    monkeypatch.setenv("CAFI_RS_PES_CLIENT_ID", "cafi-rs")
    monkeypatch.setenv("CAFI_RS_PES_CLIENT_SECRET", "s3cret")
    return PesApiClient(_config(), transport=httpx.MockTransport(handler))


def test_token_flow_and_paging(monkeypatch):
    calls = {"token": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/token":
            calls["token"] += 1
            assert b"client_credentials" in request.read()
            return httpx.Response(200, json={"access_token": "T", "expires_in": 3600})
        assert request.headers["Authorization"] == "Bearer T"
        page = int(request.url.params["page"])
        if page == 1:  # full page -> client must fetch page 2
            items = [{"id": f"A{i}", "applicationDate": "2024-06-01"} for i in range(PAGE_SIZE)]
        else:  # short page, includes one duplicate of page 1
            items = [
                {"id": "A0", "applicationDate": "2024-06-01"},
                {"id": "B1", "applicationDate": "2024-06-02"},
            ]
        return httpx.Response(200, json={"items": items})

    client = _client(monkeypatch, handler)
    apps = client.fetch_applications()
    client.close()

    assert len(apps) == PAGE_SIZE + 1  # duplicate dropped
    assert calls["token"] == 1  # token cached across pages


def test_normalize_application_variants():
    obj = normalize_application(
        {
            "Id": "42",
            "ApplicationDate": "2024-06-01T00:00:00Z",
            "ActivityType": "Agroforestry",
            "Point": {"x": 15.2, "y": -1.4},
            "EstimatedArea": "3.5",
            "Shape": {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]},
        }
    )
    assert obj.object_type is ObjectType.APPLICATION
    assert obj.object_date == obj.application_date == date(2024, 6, 1)
    assert obj.point == (15.2, -1.4)
    assert obj.estimated_area_ha == 3.5
    assert json.loads(obj.shape_wkt)["type"] == "Polygon"


def test_normalize_application_epoch_millis_date():
    obj = normalize_application({"id": "A", "applicationdate": 1717200000000})
    assert obj.application_date == date(2024, 6, 1)


def test_normalize_visit_inherits_parent_baseline():
    visit = normalize_visit(
        {"id": "M1", "visitDate": "2025-03-15", "applicationId": "42"},
        {"42": date(2024, 6, 1)},
    )
    assert visit.object_type is ObjectType.MONITORING_VISIT
    assert visit.application_date == date(2024, 6, 1)  # parent's, per spec §3
    assert visit.object_date == date(2025, 3, 15)


def test_normalize_visit_without_parent_is_exception():
    with pytest.raises(ValueError, match="parent_failed"):
        normalize_visit({"id": "M2", "visitDate": "2025-03-15", "applicationId": "999"}, {})


def test_normalize_bad_date_is_exception():
    with pytest.raises(ValueError, match="bad_object_date"):
        normalize_application({"id": "A", "activitytype": "Reforestation"})
