"""PES Open API client — spec §2.1 and §4 steps 1–3.

Reads the two endpoints (/api/v1/applications, /api/v1/monitoring-visits)
with Keycloak client-credentials auth, paging and de-duplication, and
normalises records into the common PesObject model.

Field-name mapping: the spec describes the *content* of each endpoint but not
its JSON field names, so extraction is tolerant (several candidate names per
field, case-insensitive). All candidates live in FIELD_CANDIDATES — when the
real payload differs, that table is the only thing to update.
"""

import time
from collections.abc import Iterator
from datetime import UTC, date, datetime
from typing import Any

import httpx

from .config import PipelineConfig
from .models import ObjectType, PesObject

PAGE_SIZE = 200

FIELD_CANDIDATES: dict[str, list[str]] = {
    "id": ["id", "applicationid", "applicationId", "recordid"],
    "visit_id": ["id", "monitoringvisitid", "visitid"],
    "application_ref": ["applicationid", "applicationId", "parentrecordid", "contractapplicationid"],
    "application_date": ["applicationdate", "applicationDate", "enrolmentdate", "createddate"],
    "visit_date": ["visitdate", "monitoringdate", "objectdate", "date"],
    "activity": ["activitytype", "activity", "pesactivity"],
    "shape": ["shape", "geometry", "polygon", "parcelshape"],
    "point": ["point", "location", "coordinates"],
    "estimated_area": ["estimatedarea", "estimatedareaha", "areaha", "estimated_area"],
}


def _pick(record: dict[str, Any], field: str) -> Any:
    lowered = {k.lower(): v for k, v in record.items()}
    for cand in FIELD_CANDIDATES[field]:
        if cand.lower() in lowered:
            return lowered[cand.lower()]
    return None


def _as_date(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, (int, float)):  # epoch millis (ArcGIS-style)
        return datetime.fromtimestamp(value / 1000, tz=UTC).date()
    return datetime.fromisoformat(str(value).replace("Z", "+00:00")).date()


def _as_point(value: Any) -> tuple[float, float] | None:
    if value is None:
        return None
    if isinstance(value, dict):
        x = value.get("x") or value.get("lon") or value.get("longitude")
        y = value.get("y") or value.get("lat") or value.get("latitude")
        if x is not None and y is not None:
            return float(x), float(y)
        return None
    if isinstance(value, (list, tuple)) and len(value) == 2:
        return float(value[0]), float(value[1])
    return None


def _as_shape(value: Any) -> str | None:
    """Shape arrives as WKT or JSON polygon (spec §10); keep it verbatim as a
    string — geometry validation happens at parcel resolution."""
    if value is None:
        return None
    if isinstance(value, str):
        return value or None
    import json

    return json.dumps(value)


def normalize_application(record: dict[str, Any]) -> PesObject:
    app_date = _as_date(_pick(record, "application_date"))
    if app_date is None:
        raise ValueError("bad_object_date")
    raw_area = _pick(record, "estimated_area")
    return PesObject(
        object_id=str(_pick(record, "id")),
        object_type=ObjectType.APPLICATION,
        object_date=app_date,
        application_date=app_date,
        application_id=str(_pick(record, "id")),
        pes_activity=_pick(record, "activity"),
        shape_wkt=_as_shape(_pick(record, "shape")),
        point=_as_point(_pick(record, "point")),
        estimated_area_ha=float(raw_area) if raw_area is not None else None,
    )


def normalize_visit(record: dict[str, Any], application_dates: dict[str, date]) -> PesObject:
    visit_date = _as_date(_pick(record, "visit_date"))
    if visit_date is None:
        raise ValueError("bad_object_date")
    app_id = _pick(record, "application_ref")
    if app_id is None:
        raise ValueError("parent_failed")
    app_id = str(app_id)
    app_date = application_dates.get(app_id)
    if app_date is None:
        raise ValueError("parent_failed")
    return PesObject(
        object_id=str(_pick(record, "visit_id")),
        object_type=ObjectType.MONITORING_VISIT,
        object_date=visit_date,
        application_date=app_date,
        application_id=app_id,
        pes_activity=_pick(record, "activity"),
        shape_wkt=_as_shape(_pick(record, "shape")),
        point=_as_point(_pick(record, "point")),
        estimated_area_ha=None,
    )


class PesApiClient:
    """Keycloak client-credentials auth + paged reads (spec §4 steps 1–2).

    Credentials come only from the environment/secret store (spec §2.1);
    the token is cached and refreshed 60 s before expiry.
    """

    def __init__(self, config: PipelineConfig, transport: httpx.BaseTransport | None = None):
        self._config = config
        self._http = httpx.Client(
            base_url=config.pes_api_base, timeout=30, transport=transport
        )
        self._token: str | None = None
        self._token_expiry: float = 0.0

    def close(self) -> None:
        self._http.close()

    def _access_token(self) -> str:
        if self._token is None or time.monotonic() >= self._token_expiry - 60:
            import os

            resp = self._http.post(
                self._config.pes_oidc_token_url,
                data={
                    "grant_type": "client_credentials",
                    "client_id": os.environ["CAFI_RS_PES_CLIENT_ID"],
                    "client_secret": os.environ["CAFI_RS_PES_CLIENT_SECRET"],
                },
            )
            resp.raise_for_status()
            payload = resp.json()
            self._token = payload["access_token"]
            self._token_expiry = time.monotonic() + float(payload.get("expires_in", 300))
        return self._token

    def _paged(self, path: str) -> Iterator[dict[str, Any]]:
        """Fetch every page, de-duplicating by record id across pages."""
        seen: set[str] = set()
        page = 1
        while True:
            resp = self._http.get(
                path,
                params={"page": page, "pageSize": PAGE_SIZE},
                headers={"Authorization": f"Bearer {self._access_token()}"},
            )
            resp.raise_for_status()
            body = resp.json()
            items = body.get("items", body) if isinstance(body, dict) else body
            if not items:
                return
            for record in items:
                rid = str(record.get("id", id(record)))
                if rid not in seen:
                    seen.add(rid)
                    yield record
            if len(items) < PAGE_SIZE:
                return
            page += 1

    def fetch_applications(self) -> list[dict[str, Any]]:
        return list(self._paged("/api/v1/applications"))

    def fetch_monitoring_visits(self) -> list[dict[str, Any]]:
        return list(self._paged("/api/v1/monitoring-visits"))
