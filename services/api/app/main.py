"""CAFI RS Platform API.

The single data door for the web app (design doc §3.2, §6.2). Serves the
RS pipeline's output tables; the frontend never talks to upstream systems.

Families are keyed by application_id; contract_code is carried on every
record (confirmed against the PES system's synced layers), so contract
routes filter on it directly.

Staff-tier endpoints require an OIDC bearer token from the platform's
Keycloak realm (app/auth.py); /api/health stays open. With no issuer
configured (local dev), auth is disabled. The spec §9 privacy curation
applies to the future public tier, not these staff endpoints.
"""

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .auth import CurrentUser, Principal
from .db import get_conn
from .alerts import router as alerts_router
from .analyses import router as analyses_router
from .aoi import router as aoi_router
from .contracts import router as contracts_router
from .dashboard import router as dashboard_router
from .photos import router as photos_router
from .profile import router as profile_router
from .governance import router as governance_router
from .schemas import (
    ApplicationList,
    ApplicationSummary,
    FilterOptions,
    IndicatorRowOut,
    RunHealth,
)
from .settings import settings

app = FastAPI(title="CAFI RS Platform API", version="0.1.0")

app.include_router(governance_router)
app.include_router(dashboard_router)
app.include_router(alerts_router)
app.include_router(aoi_router)
app.include_router(photos_router)
app.include_router(contracts_router)
app.include_router(profile_router)
app.include_router(analyses_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "service": "cafi-rs-api", "version": app.version}


_APPLICATION_LIST_SQL = """
SELECT p.application_id, p.application_code, p.contract_code,
       p.application_date, p.pes_activity,
       p.country, p.province, p.implementing_org, p.project_name,
       p.estimated_area_ha,
       o.parcel_area_ha, o.tree_cover_ha, o.defor_5yr_ha_yr, o.status,
       (SELECT count(*) FROM pes_rs_objects v
         WHERE v.application_id = p.application_id
           AND v.object_type = 'monitoring_visit') AS visit_count,
       o.processed_utc,
       count(*) OVER () AS total
FROM pes_parcels p
LEFT JOIN pes_rs_objects o
  ON o.object_id = p.application_id AND o.object_type = 'application'
WHERE (%(activity)s::text IS NULL OR p.pes_activity = %(activity)s)
  AND (%(country)s::text IS NULL OR p.country = %(country)s)
  AND (%(province)s::text IS NULL OR p.province = %(province)s)
  AND (%(org)s::text IS NULL OR p.implementing_org = %(org)s)
  AND (%(project)s::text IS NULL OR p.project_name = %(project)s)
  AND (%(status)s::text IS NULL OR o.status::text = %(status)s)
  AND (%(q)s::text IS NULL OR p.application_id ILIKE '%%' || %(q)s || '%%'
       OR p.application_code ILIKE '%%' || %(q)s || '%%'
       OR p.contract_code ILIKE '%%' || %(q)s || '%%')
ORDER BY p.application_date DESC, p.application_id
LIMIT %(limit)s OFFSET %(offset)s
"""


@app.get("/api/applications", response_model=ApplicationList)
def list_applications(
    activity: str | None = None,
    country: str | None = None,
    province: str | None = None,
    org: str | None = None,
    project: str | None = None,
    status: str | None = None,
    q: str | None = Query(None, description="id / application code / contract code substring"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    conn=Depends(get_conn),
    user: Principal = CurrentUser,
) -> ApplicationList:
    rows = conn.execute(
        _APPLICATION_LIST_SQL,
        {
            "activity": activity,
            "country": country,
            "province": province,
            "org": org,
            "project": project,
            "status": status,
            "q": q,
            "limit": limit,
            "offset": offset,
        },
    ).fetchall()
    total = rows[0][-1] if rows else 0
    items = [
        ApplicationSummary(
            application_id=r[0],
            application_code=r[1],
            contract_code=r[2],
            application_date=r[3],
            pes_activity=r[4],
            country=r[5],
            province=r[6],
            implementing_org=r[7],
            project_name=r[8],
            estimated_area_ha=r[9],
            parcel_area_ha=r[10],
            tree_cover_ha=r[11],
            defor_5yr_ha_yr=r[12],
            status=r[13],
            visit_count=r[14],
            last_processed_utc=r[15],
        )
        for r in rows
    ]
    return ApplicationList(items=items, total=total)


_INDICATOR_COLUMNS = """
object_id, object_type, object_date, application_code, contract_code,
pes_activity, parcel_area_ha,
tree_cover_ha, defor_5yr_ha_yr, defor_current_ha, defor_alerts_5yr,
defor_alerts_current, fire_alerts_5yr, fire_alerts_current,
burned_area_5yr_ha, burned_area_current_ha, current_start, geom_source,
tc_window_days, tc_coverage, baseline_years, status, failed_indicators,
processed_utc
"""


def _row_out(r) -> IndicatorRowOut:
    cols = [c.strip() for c in _INDICATOR_COLUMNS.replace("\n", " ").split(",")]
    return IndicatorRowOut(**dict(zip(cols, r, strict=True)))


@app.get("/api/filters", response_model=FilterOptions)
def filter_options(
    country: str | None = None,
    conn=Depends(get_conn),
    user: Principal = CurrentUser,
) -> FilterOptions:
    """Distinct values feeding the filter selects. Provinces narrow to the
    chosen country when one is passed (portal-v1 behaviour)."""

    def distinct(column: str, where: str = "", params: tuple = ()) -> list[str]:
        rows = conn.execute(
            f"SELECT DISTINCT {column} FROM pes_parcels "
            f"WHERE {column} IS NOT NULL {where} ORDER BY {column}",
            params,
        ).fetchall()
        return [r[0] for r in rows]

    return FilterOptions(
        countries=distinct("country"),
        provinces=distinct(
            "province", "AND (%s::text IS NULL OR country = %s)", (country, country)
        ),
        organisations=distinct("implementing_org"),
        projects=distinct("project_name"),
        activities=distinct("pes_activity"),
    )


@app.get("/api/applications.geojson")
def applications_geojson(conn=Depends(get_conn), user: Principal = CurrentUser) -> dict:
    """Every parcel as a GeoJSON FeatureCollection for the map workspace.
    Polygon from shape_raw when it parses, point fallback otherwise;
    records with no usable geometry are omitted."""
    from .geo import shape_to_geometry
    from .profile import _pick

    rows = conn.execute(
        """
        SELECT p.application_id, p.application_code, p.contract_code, p.pes_activity,
               p.application_date, p.shape_raw, p.point_lon, p.point_lat,
               o.status, o.tree_cover_ha,
               p.country, p.province, p.implementing_org, p.project_name,
               r.payload, o.parcel_area_ha, p.estimated_area_ha
        FROM pes_parcels p
        LEFT JOIN pes_rs_objects o
          ON o.object_id = p.application_id AND o.object_type = 'application'
        LEFT JOIN pes_raw_records r
          ON r.kind = 'application' AND r.record_id = p.application_id
        """
    ).fetchall()
    # v1 DataLoad parity: EVERY application gets a point (native Point, else
    # its first GPS photo, else the polygon centroid) so small parcels stay
    # visible at any zoom; polygons come on top for records that have shapes.
    photo_pts = {
        a: (lon, lat)
        for a, lon, lat in conn.execute(
            """
            SELECT DISTINCT ON (application_id) application_id, lon, lat
            FROM pes_photos
            WHERE application_id IS NOT NULL AND NOT (lon = 0 AND lat = 0)
            ORDER BY application_id, kind, photo_index
            """
        ).fetchall()
    }
    features = []
    for r in rows:
        geometries: list[dict] = []
        polygon = shape_to_geometry(r[5], None, None)
        if polygon is not None and polygon.get("type") != "Point":
            geometries.append(polygon)
        else:
            polygon = None
        point = None
        if r[6] is not None and r[7] is not None:
            point = [r[6], r[7]]
        elif r[0] in photo_pts:
            point = list(photo_pts[r[0]])
        elif polygon is not None:
            try:
                from shapely.geometry import shape as to_shape

                c = to_shape(polygon).centroid
                point = [c.x, c.y]
            except Exception:  # noqa: BLE001 — bad shape: no derived point
                point = None
        if point is not None:
            geometries.append({"type": "Point", "coordinates": point})
        payload = r[14] or {}
        for geometry in geometries:
            features.append(
            {
                "type": "Feature",
                "geometry": geometry,
                "properties": {
                    "applicationId": r[0],
                    "applicationCode": r[1],
                    "contractCode": r[2],
                    "pesActivity": r[3],
                    "applicationDate": r[4].isoformat(),
                    "status": r[8],
                    "treeCoverHa": r[9],
                    "areaHa": r[15] if r[15] is not None else r[16],
                    # v1 filter fields (M7e): parcel columns + raw payload.
                    "country": r[10],
                    "province": r[11],
                    "org": r[12],
                    "project": r[13],
                    "beneficiaryType": _pick(payload, ["beneficiarytype"]),
                    "gender": _pick(payload, ["beneficiarygender", "gender"]),
                    "applicationStatus": _pick(payload, ["applicationstatus", "contractstatus", "status"]),
                },
            }
        )
    return {"type": "FeatureCollection", "features": features}


@app.get("/api/applications/{application_id}/indicators", response_model=list[IndicatorRowOut])
def application_indicators(
    application_id: str, conn=Depends(get_conn), user: Principal = CurrentUser
) -> list[IndicatorRowOut]:
    """The family's rows (application + monitoring visits), oldest first —
    the M2 dossier timeline."""
    rows = conn.execute(
        f"""
        SELECT {_INDICATOR_COLUMNS} FROM pes_rs_objects
        WHERE application_id = %s
        ORDER BY object_date, object_id
        """,
        (application_id,),
    ).fetchall()
    if not rows:
        known = conn.execute(
            "SELECT 1 FROM pes_parcels WHERE application_id = %s", (application_id,)
        ).fetchone()
        if known is None:
            raise HTTPException(status_code=404, detail="unknown application")
    return [_row_out(r) for r in rows]


@app.get("/api/contracts/{contract_code}/indicators", response_model=list[IndicatorRowOut])
def contract_indicators(
    contract_code: str, conn=Depends(get_conn), user: Principal = CurrentUser
) -> list[IndicatorRowOut]:
    """Every family row under a contract code — the M2 contract dossier."""
    rows = conn.execute(
        f"""
        SELECT {_INDICATOR_COLUMNS} FROM pes_rs_objects
        WHERE contract_code = %s
        ORDER BY object_date, object_id
        """,
        (contract_code,),
    ).fetchall()
    if not rows:
        known = conn.execute(
            "SELECT 1 FROM pes_parcels WHERE contract_code = %s", (contract_code,)
        ).fetchone()
        if known is None:
            raise HTTPException(status_code=404, detail="unknown contract")
    return [_row_out(r) for r in rows]


@app.get("/api/health/runs", response_model=list[RunHealth])
def run_health(
    limit: int = Query(20, ge=1, le=200),
    conn=Depends(get_conn),
    user: Principal = CurrentUser,
) -> list[RunHealth]:
    """Recent pipeline runs (spec §6.5) for the M2 ops page."""
    rows = conn.execute(
        """
        SELECT run_id, start_utc, end_utc, duration_s, fetched_app, fetched_mon,
               selected, ok, partial, skipped, queued, stopped_reason
        FROM pes_rs_runs ORDER BY run_id DESC LIMIT %s
        """,
        (limit,),
    ).fetchall()
    fields = [
        "run_id", "start_utc", "end_utc", "duration_s", "fetched_app", "fetched_mon",
        "selected", "ok", "partial", "skipped", "queued", "stopped_reason",
    ]
    return [RunHealth(**dict(zip(fields, r, strict=True))) for r in rows]
