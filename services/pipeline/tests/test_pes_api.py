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
    monkeypatch.setenv("CAFI_RS_PES_USERNAME", "svc-user")
    monkeypatch.setenv("CAFI_RS_PES_PASSWORD", "svc-pass")
    return PesApiClient(_config(), transport=httpx.MockTransport(handler))


def test_token_flow_and_paging(monkeypatch):
    calls = {"token": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/token":
            calls["token"] += 1
            body = request.read()
            # Password grant (the PES realm's flow): user creds + client creds.
            assert b"grant_type=password" in body
            assert b"username=svc-user" in body and b"client_secret=s3cret" in body
            return httpx.Response(200, json={"access_token": "T", "expires_in": 3600})
        assert request.headers["Authorization"] == "Bearer T"
        # Spec §4: PageNumber/PageSize params, PascalCase envelope.
        page = int(request.url.params["PageNumber"])
        assert int(request.url.params["PageSize"]) == PAGE_SIZE
        if page == 1:
            items = [{"ApplicationId": f"A{i}", "ApplicationDate": "2024-06-01"}
                     for i in range(PAGE_SIZE)]
        else:  # last page, includes one duplicate of page 1
            items = [
                {"ApplicationId": "A0", "ApplicationDate": "2024-06-01"},
                {"ApplicationId": "B1", "ApplicationDate": "2024-06-02"},
            ]
        return httpx.Response(200, json={
            "Items": items,
            "TotalCount": PAGE_SIZE + 2,
            "TotalPages": 2,
            "CurrentPage": page,
            "PageSize": PAGE_SIZE,
        })

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


def test_client_credentials_grant_via_env(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/token":
            body = request.read()
            assert b"grant_type=client_credentials" in body
            assert b"username" not in body
            return httpx.Response(200, json={"access_token": "T", "expires_in": 3600})
        return httpx.Response(200, json={"items": []})

    monkeypatch.setenv("CAFI_RS_PES_GRANT_TYPE", "client_credentials")
    client = _client(monkeypatch, handler)
    assert client.fetch_applications() == []
    client.close()


def test_totalpages_envelope_stops_paging_exactly(monkeypatch):
    requested: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/token":
            return httpx.Response(200, json={"access_token": "T", "expires_in": 3600})
        page = int(request.url.params["PageNumber"])
        requested.append(page)
        # One full page, but TotalPages says it is the only one: the client
        # must NOT request page 2 (the legacy short-page rule would have).
        items = [{"ApplicationId": f"A{i}", "ApplicationDate": "2024-06-01"}
                 for i in range(PAGE_SIZE)]
        return httpx.Response(200, json={
            "Items": items, "TotalCount": PAGE_SIZE, "TotalPages": 1,
            "CurrentPage": page, "PageSize": PAGE_SIZE,
        })

    client = _client(monkeypatch, handler)
    assert len(client.fetch_applications()) == PAGE_SIZE
    client.close()
    assert requested == [1]


def test_live_payload_shapes_normalize():
    """Field names exactly as the production API serves them (Sept 2026):
    applications have ApplicationCode but no ApplicationId/ContractCode;
    visits reference the parent via ApplicationCode and are identified by
    MonitoringVisitCode."""
    app = normalize_application({
        "ApplicationCode": "CA1124-BE1076",
        "ApplicationDate": "2026-09-22",
        "ApplicationStatus": "Archived",
        "ActivityType": "Agroforestry",
        "EstimatedArea": "0.1",          # string containing a dot-decimal
        "Shape": "POLYGON((15 -4,15.01 -4,15.01 -3.99,15 -4))",
        "Point": None,
    })
    assert app.object_id == "CA1124-BE1076"  # id falls back to the code
    assert app.application_id == "CA1124-BE1076"
    assert app.application_code == "CA1124-BE1076"
    assert app.contract_code is None
    assert app.estimated_area_ha == 0.1
    assert app.object_date == date(2026, 9, 22)

    visit = normalize_visit(
        {
            "MonitoringVisitCode": "MV-0007",
            "MonitoringDate": "2026-09-25",
            "ApplicationCode": "CA1124-BE1076",
            "ContractCode": "CC-0042",
            "ActivityType": "Agroforestry",
            "Shape": None,
        },
        {"CA1124-BE1076": date(2026, 9, 22)},
    )
    assert visit.object_id == "MV-0007"
    assert visit.application_id == "CA1124-BE1076"
    assert visit.contract_code == "CC-0042"
    assert visit.application_date == date(2026, 9, 22)  # parent's baseline
    assert visit.object_date == date(2026, 9, 25)


def test_dedup_key_prefers_visit_code_over_application_code():
    """Visits carry both codes; de-dup must use the visit's own id, or every
    application would keep only one visit."""
    from pes_rs_pipeline.pes_api import _pick

    visit = {"MonitoringVisitCode": "MV-1", "ApplicationCode": "CA-1"}
    assert _pick(visit, "id") == "MV-1"
    # ApplicationCode is the id only when no visit code is present:
    assert _pick({"ApplicationCode": "CA-1"}, "id") == "CA-1"
