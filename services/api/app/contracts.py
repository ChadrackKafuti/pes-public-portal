"""PES contracts layer — derived from monitoring visits (M12).

The production DataLoad script builds its contracts layer by grouping
monitoring visits by ContractCode: attributes come from the latest completed
visit (else the earliest future visit, else an undated one) and geometry from
the first visit carrying a shape, falling back to the linked application's
polygon. The raw visit mirror (pes_raw_records) plus the parcel cache already
hold everything that script fetched, so contracts are assembled here at query
time — no extra upstream fetch, no extra table, always as fresh as the last
ingest run.
"""

import json
from datetime import date
from typing import Any

from fastapi import APIRouter, Depends

from .auth import CurrentUser, Principal
from .db import get_conn
from .geo import shape_to_geometry
from .profile import _date, _num, _pick

router = APIRouter()

_VISIT_DATE_KEYS = ["monitoringdate", "visitdate", "objectdate", "date"]
_VISIT_ID_KEYS = ["monitoringvisitcode", "monitoringvisitid", "id", "visitid"]
_APP_REF_KEYS = ["applicationid", "parentrecordid", "contractapplicationid",
                 "applicationcode"]
_SHAPE_KEYS = ["shape", "shapewkt", "geometry", "polygon", "parcelshape"]


def _visit_date(payload: dict) -> date | None:
    return _date(_pick(payload, _VISIT_DATE_KEYS))


def visit_contract_links(conn) -> dict[str, str]:
    """application_id -> contract_code, derived from the raw visit mirror.

    Production applications carry no ContractCode (confirmed against the live
    payloads): the linkage arrives only on monitoring visits, which reference
    their application by id or code. Everything that groups applications by
    contract resolves the link here, with pes_parcels.contract_code (filled
    where sources do carry it) as the caller-side first choice."""
    index: dict[str, str] = {}  # application_id AND application_code -> id
    for aid, acode in conn.execute(
        "SELECT application_id, application_code FROM pes_parcels"
    ).fetchall():
        index[str(aid)] = str(aid)
        if acode:
            index.setdefault(str(acode), str(aid))
    from .visibility import visit_hidden

    links: dict[str, str] = {}
    for (payload,) in conn.execute(
        "SELECT payload FROM pes_raw_records WHERE kind = 'monitoring_visit'"
    ).fetchall():
        if visit_hidden(payload):  # archived/deleted visits (M14)
            continue
        code = _pick(payload, ["contractcode"])
        ref = _pick(payload, _APP_REF_KEYS)
        if code is None or ref is None:
            continue
        app_id = index.get(str(ref))
        if app_id:
            links[app_id] = str(code).strip()
    return links


def _visit_polygon(payload: dict) -> dict | None:
    raw = _pick(payload, _SHAPE_KEYS)
    if raw is None:
        return None
    if not isinstance(raw, str):
        raw = json.dumps(raw)
    geom = shape_to_geometry(raw, None, None)
    return geom if geom is not None and geom.get("type") != "Point" else None


def _centroid(polygon: dict) -> list[float] | None:
    try:
        from shapely.geometry import shape as to_shape

        c = to_shape(polygon).centroid
        return [c.x, c.y]
    except Exception:  # noqa: BLE001 — bad shape: no derived point
        return None


def build_contracts(
    visits: list[dict], parcels: dict[str, dict[str, Any]], today: date
) -> list[dict]:
    """DataLoad ``build_contract_records`` parity, as pure data.

    ``parcels`` maps application_id/application_code to
    ``{"shape_raw", "point", "application_code"}``; polygons are parsed
    lazily so only contracts that need the fallback pay for it.
    """
    grouped: dict[str, list[dict]] = {}
    for v in visits:
        code = _pick(v, ["contractcode"])
        if code:
            grouped.setdefault(str(code).strip(), []).append(v)

    app_polygons: dict[str, dict | None] = {}  # lazy parse cache

    def parcel_polygon(ref: str) -> dict | None:
        if ref not in app_polygons:
            p = parcels.get(ref)
            geom = shape_to_geometry(p["shape_raw"], None, None) if p else None
            app_polygons[ref] = (
                geom if geom is not None and geom.get("type") != "Point" else None
            )
        return app_polygons[ref]

    out: list[dict] = []
    for code, group in sorted(grouped.items()):
        completed = sorted(
            (v for v in group if (_visit_date(v) or date.max) <= today),
            key=_visit_date, reverse=True,
        )
        future = sorted(
            (v for v in group if (_visit_date(v) or date.min) > today),
            key=_visit_date,
        )
        undated = [v for v in group if _visit_date(v) is None]
        if completed:
            base, rule = completed[0], "latest_completed_visit"
        elif future:
            base, rule = future[0], "earliest_future_visit_no_completed_visit"
        else:
            base, rule = undated[0], "undated_visit_no_dated_visit"
        from .visibility import contract_hidden  # late: avoids import cycle

        if contract_hidden(base):  # archived/deleted contract (M14)
            continue

        polygon = None
        source = None
        geometry_visit = None
        with_geometry = 0
        for cand in completed + future + undated:
            g = _visit_polygon(cand)
            if g is not None:
                with_geometry += 1
                if polygon is None:
                    polygon, source = g, "monitoring_visit_shape"
                    gid = _pick(cand, _VISIT_ID_KEYS)
                    geometry_visit = str(gid) if gid is not None else None

        app_id = None
        for cand in group:
            ref = _pick(cand, _APP_REF_KEYS)
            if ref is not None and str(ref) in parcels:
                app_id = str(ref)
                break
        if polygon is None and app_id is not None:
            fallback = parcel_polygon(app_id)
            if fallback is not None:
                polygon, source = fallback, "application_shape_fallback"

        point = _centroid(polygon) if polygon is not None else None
        if point is None and app_id is not None:
            p = parcels.get(app_id) or {}
            point = p.get("point")

        parcel = parcels.get(app_id or "", {})
        out.append(
            {
                "contract_code": code,
                "application_id": app_id,
                "application_code": (
                    _pick(base, ["applicationcode"]) or parcel.get("application_code")
                ),
                "activity": _pick(base, ["activitytype", "pesactivityname",
                                         "activity", "pesactivity"]),
                "status": _pick(base, ["contractstatus"]),
                "start_date": _date(_pick(base, ["contractstartdate", "startdate"])),
                "end_date": _date(_pick(base, ["contractenddate", "enddate"])),
                "contracted_area_ha": _num(
                    _pick(base, ["contractedpesarea", "contractedarea"])
                ),
                "visit_count": len(group),
                "visits_with_geometry": with_geometry,
                "selected_visit_rule": rule,
                "geometry_source": source or "no_polygon_available",
                "geometry_visit": geometry_visit,
                "polygon": polygon,
                "point": point,
            }
        )
    return out


def contract_code_visibility(conn) -> tuple[set[str], set[str]]:
    """(contract codes whose selected visit is live, all codes seen on any
    visit). A code present on visits but absent from the live set is an
    archived/deleted contract (M14) and must not be served anywhere."""
    from .visibility import visit_hidden

    visits = [
        p
        for (p,) in conn.execute(
            "SELECT payload FROM pes_raw_records WHERE kind = 'monitoring_visit'"
        ).fetchall()
        if not visit_hidden(p)
    ]
    all_codes = {
        str(_pick(v, ["contractcode"])).strip()
        for v in visits
        if _pick(v, ["contractcode"])
    }
    live = {c["contract_code"] for c in build_contracts(visits, {}, date.today())}
    return live, all_codes


@router.get("/api/contracts.geojson")
def contracts_geojson(conn=Depends(get_conn), user: Principal = CurrentUser) -> dict:
    """Contracts as a FeatureCollection: a Polygon per contract with usable
    geometry plus a Point for every contract (centroid else application
    point), mirroring the applications layer's small-parcel visibility."""
    from .visibility import hidden_application_ids, visit_hidden

    visits = [
        r[0]
        for r in conn.execute(
            "SELECT payload FROM pes_raw_records WHERE kind = 'monitoring_visit'"
        ).fetchall()
        if not visit_hidden(r[0])  # archived/deleted visits (M14)
    ]
    hidden_apps = hidden_application_ids(conn)
    parcels: dict[str, dict[str, Any]] = {}
    for aid, acode, shape_raw, lon, lat in conn.execute(
        """
        SELECT application_id, application_code, shape_raw, point_lon, point_lat
        FROM pes_parcels
        """
    ).fetchall():
        entry = {
            "application_code": acode,
            "shape_raw": shape_raw,
            "point": [lon, lat] if lon is not None and lat is not None else None,
        }
        parcels[str(aid)] = entry
        if acode and str(acode) not in parcels:
            parcels[str(acode)] = entry

    features = []
    for c in build_contracts(visits, parcels, date.today()):
        if c["application_id"] in hidden_apps:  # archived application (M14)
            continue
        props = {
            "contractCode": c["contract_code"],
            "applicationId": c["application_id"],
            "applicationCode": c["application_code"],
            "pesActivity": c["activity"],
            "contractStatus": c["status"],
            "startDate": c["start_date"].isoformat() if c["start_date"] else None,
            "endDate": c["end_date"].isoformat() if c["end_date"] else None,
            "contractedAreaHa": c["contracted_area_ha"],
            "visitCount": c["visit_count"],
            "visitsWithGeometry": c["visits_with_geometry"],
            "selectedVisitRule": c["selected_visit_rule"],
            "geometrySource": c["geometry_source"],
        }
        if c["polygon"] is not None:
            features.append(
                {"type": "Feature", "geometry": c["polygon"], "properties": props}
            )
        if c["point"] is not None:
            features.append(
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": c["point"]},
                    "properties": props,
                }
            )
    return {"type": "FeatureCollection", "features": features}
