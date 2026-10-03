"""Monthly NDVI phenology (M29b).

Per parcel, a rolling window of monthly Sentinel-2 NDVI means plus the
same months over the control annulus. One curve, two readings: for
deforestation-free agriculture its shape shows cropping intensity
(double-cropping = two peaks a year); for planting activities it is the
fine-grained greening trajectory between the annual tree-cover points.
Each parcel costs two getInfo round trips regardless of how many months
are missing; parcels rotate country-priority (ROC → DRC → Cameroon) and
stalest-first inside a small budget.
"""

import logging
from datetime import UTC, date, datetime, timedelta

from ..config import PipelineConfig
from ..geometry import resolve_geom_source
from .annual import _bearer

log = logging.getLogger(__name__)

_CANDIDATES_SQL = """
SELECT p.application_id, p.shape_raw, p.point_lon, p.point_lat,
       p.estimated_area_ha, p.application_date,
       (SELECT max(month) FROM pes_ndvi_monthly n
        WHERE n.application_id = p.application_id) AS last_month
FROM pes_parcels p
WHERE NOT (p.application_id = ANY(%(hidden)s))
  AND (p.shape_raw IS NOT NULL OR p.point_lon IS NOT NULL)
  AND (p.estimated_area_ha IS NULL OR p.estimated_area_ha <= %(max_ha)s)
  AND NOT EXISTS (
    SELECT 1 FROM pes_ndvi_monthly n
    WHERE n.application_id = p.application_id AND n.month = %(latest)s
  )
ORDER BY
  CASE
    WHEN p.country ILIKE '%%cameroon%%' OR p.country ILIKE '%%cameroun%%' THEN 2
    WHEN p.country ILIKE '%%democratic%%' OR p.country ILIKE '%%démocratique%%'
         OR p.country ILIKE 'DRC%%' OR p.country ILIKE 'RDC%%' THEN 1
    WHEN p.country ILIKE '%%congo%%' OR p.country ILIKE 'ROC%%' THEN 0
    ELSE 3
  END,
  (SELECT max(month) FROM pes_ndvi_monthly n
   WHERE n.application_id = p.application_id) ASC NULLS FIRST
LIMIT %(limit)s
"""


def month_window(today: date, n_months: int) -> list[date]:
    """The last n complete months, oldest first (never the current month)."""
    first_this = today.replace(day=1)
    months: list[date] = []
    cur = first_this
    for _ in range(n_months):
        cur = (cur - timedelta(days=1)).replace(day=1)
        months.append(cur)
    return list(reversed(months))


def process_ndvi(
    conn,
    backend,
    config: PipelineConfig,
    today: date,
    hidden_ids: set[str] | None = None,
) -> dict:
    window = month_window(today, config.ndvi_months)
    rows = conn.execute(
        _CANDIDATES_SQL,
        {
            "hidden": sorted(hidden_ids or ()),
            "max_ha": config.max_area_ha,
            "latest": window[-1],
            "limit": config.ndvi_batch,
        },
    ).fetchall()
    if not rows:
        return {"ndvi_done": 0, "ndvi_failed": 0}

    deadline = datetime.now(UTC) + timedelta(seconds=config.ndvi_budget_s)
    done = failed = 0
    for row in rows:
        if datetime.now(UTC) >= deadline:
            break
        app_id = str(row[0])
        try:
            have = {
                m for (m,) in conn.execute(
                    "SELECT month FROM pes_ndvi_monthly WHERE application_id = %s",
                    (app_id,),
                ).fetchall()
            }
            missing = [m for m in window if m not in have]
            if not missing:
                continue
            obj = _bearer(row)
            geom = resolve_geom_source(obj, obj)
            if geom is None:
                continue
            source, bearer = geom
            parcel = backend.resolve_parcel(bearer, source)
            series = backend.ndvi_series(parcel, missing)
            control = backend.ndvi_series(backend.annulus(parcel), missing)
            for m in missing:
                key = m.isoformat()
                conn.execute(
                    """
                    INSERT INTO pes_ndvi_monthly
                      (application_id, month, ndvi, control_ndvi)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (application_id, month) DO UPDATE SET
                      ndvi = EXCLUDED.ndvi,
                      control_ndvi = EXCLUDED.control_ndvi,
                      computed_utc = now()
                    """,
                    (app_id, m, series.get(key), control.get(key)),
                )
            conn.commit()
            done += 1
        except Exception:  # noqa: BLE001 — one parcel never sinks the pass
            conn.rollback()
            failed += 1
            log.exception("ndvi series failed")
    return {"ndvi_done": done, "ndvi_failed": failed, "ndvi_pending": len(rows)}
