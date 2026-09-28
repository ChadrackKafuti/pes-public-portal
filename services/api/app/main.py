"""CAFI RS Platform API.

The single data door for the web app (design doc §3.2, §6.2). Serves the
RS pipeline's output tables; the frontend never talks to upstream systems.

Keyed by APPLICATION for now: the platform database keys indicator families
by application_id (spec §6.1). /api/contracts/... will join the
contract↔application linkage once the PES Open API's contract payload is
confirmed, and then becomes the primary route for M2 dossiers.

Auth note (P1): endpoints are open while OIDC wiring lands; the privacy
curation of spec §9 (public tier: tabular only, surrogate ids) applies to
the public tier, not these staff endpoints.
"""

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .db import get_conn
from .schemas import ApplicationList, ApplicationSummary, IndicatorRowOut, RunHealth
from .settings import settings

app = FastAPI(title="CAFI RS Platform API", version="0.1.0")

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
SELECT p.application_id, p.application_date, p.pes_activity, p.estimated_area_ha,
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
  AND (%(status)s::text IS NULL OR o.status::text = %(status)s)
  AND (%(q)s::text IS NULL OR p.application_id ILIKE '%%' || %(q)s || '%%')
ORDER BY p.application_date DESC, p.application_id
LIMIT %(limit)s OFFSET %(offset)s
"""


@app.get("/api/applications", response_model=ApplicationList)
def list_applications(
    activity: str | None = None,
    status: str | None = None,
    q: str | None = Query(None, description="application id substring (code search)"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    conn=Depends(get_conn),
) -> ApplicationList:
    rows = conn.execute(
        _APPLICATION_LIST_SQL,
        {"activity": activity, "status": status, "q": q, "limit": limit, "offset": offset},
    ).fetchall()
    total = rows[0][-1] if rows else 0
    items = [
        ApplicationSummary(
            application_id=r[0],
            application_date=r[1],
            pes_activity=r[2],
            estimated_area_ha=r[3],
            parcel_area_ha=r[4],
            tree_cover_ha=r[5],
            defor_5yr_ha_yr=r[6],
            status=r[7],
            visit_count=r[8],
            last_processed_utc=r[9],
        )
        for r in rows
    ]
    return ApplicationList(items=items, total=total)


_INDICATOR_COLUMNS = """
object_id, object_type, object_date, pes_activity, parcel_area_ha,
tree_cover_ha, defor_5yr_ha_yr, defor_current_ha, defor_alerts_5yr,
defor_alerts_current, fire_alerts_5yr, fire_alerts_current,
burned_area_5yr_ha, burned_area_current_ha, current_start, geom_source,
tc_window_days, tc_coverage, baseline_years, status, failed_indicators,
processed_utc
"""


def _row_out(r) -> IndicatorRowOut:
    cols = [c.strip() for c in _INDICATOR_COLUMNS.replace("\n", " ").split(",")]
    return IndicatorRowOut(**dict(zip(cols, r, strict=True)))


@app.get("/api/applications/{application_id}/indicators", response_model=list[IndicatorRowOut])
def application_indicators(application_id: str, conn=Depends(get_conn)) -> list[IndicatorRowOut]:
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


@app.get("/api/health/runs", response_model=list[RunHealth])
def run_health(limit: int = Query(20, ge=1, le=200), conn=Depends(get_conn)) -> list[RunHealth]:
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
