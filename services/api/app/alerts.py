"""Alert feed (design doc M4).

Every monitoring visit that carries a disturbance signal — RADD
deforestation alerts, VIIRS fire alerts, or measured loss/burned area in
the current period — newest first. The pipeline computes the numbers;
this endpoint only surfaces them (blank stays blank, never zero).
"""

from fastapi import APIRouter, Depends, Query

from .auth import CurrentUser, Principal
from .db import get_conn
from .schemas import AlertRow

router = APIRouter()

_ALERTS_SQL = """
SELECT o.object_id, o.object_date, o.application_id, o.application_code,
       o.contract_code, o.pes_activity, p.country, p.province,
       o.defor_alerts_current, o.fire_alerts_current,
       o.defor_current_ha, o.burned_area_current_ha, o.processed_utc
FROM pes_rs_objects o
JOIN pes_parcels p ON p.application_id = o.application_id
WHERE o.object_type = 'monitoring_visit'
  AND (coalesce(o.defor_alerts_current, 0) > 0
       OR coalesce(o.fire_alerts_current, 0) > 0
       OR coalesce(o.defor_current_ha, 0) > 0
       OR coalesce(o.burned_area_current_ha, 0) > 0)
  AND (%(country)s::text IS NULL OR p.country = %(country)s)
ORDER BY o.object_date DESC, o.object_id
LIMIT %(limit)s
"""

_FIELDS = [
    "object_id", "object_date", "application_id", "application_code",
    "contract_code", "pes_activity", "country", "province",
    "defor_alerts_current", "fire_alerts_current",
    "defor_current_ha", "burned_area_current_ha", "processed_utc",
]


@router.get("/api/alerts", response_model=list[AlertRow])
def alerts(
    country: str | None = None,
    limit: int = Query(200, ge=1, le=1000),
    conn=Depends(get_conn),
    user: Principal = CurrentUser,
) -> list[AlertRow]:
    rows = conn.execute(_ALERTS_SQL, {"country": country, "limit": limit}).fetchall()
    return [AlertRow(**dict(zip(_FIELDS, r, strict=True))) for r in rows]
