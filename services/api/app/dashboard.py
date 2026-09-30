"""Jurisdictional dashboard aggregates (design doc M5).

One payload feeds the whole dashboard page: PES programme totals and
breakdowns (optionally narrowed to a country) plus the basin-wide
forest-governance inventory. Blank-is-not-zero carries through: sums of
NULL indicator values stay NULL, never 0.
"""

from fastapi import APIRouter, Depends

from .auth import CurrentUser, Principal
from .db import get_conn
from .schemas import DashboardOut
from .governance import GOV_LAYERS, _PRODUCTION_FILTER

router = APIRouter()

_TOTALS_SQL = """
SELECT count(*),
       sum(coalesce(o.parcel_area_ha, p.estimated_area_ha)),
       sum(o.tree_cover_ha),
       (SELECT count(*) FROM pes_rs_objects v
         JOIN pes_parcels vp ON vp.application_id = v.application_id
        WHERE v.object_type = 'monitoring_visit'
          AND (%(country)s::text IS NULL OR vp.country = %(country)s)),
       count(*) FILTER (WHERE o.status = 'ok'),
       count(*) FILTER (WHERE o.status = 'partial'),
       count(*) FILTER (WHERE o.status = 'partial_final')
FROM pes_parcels p
LEFT JOIN pes_rs_objects o
  ON o.object_id = p.application_id AND o.object_type = 'application'
WHERE (%(country)s::text IS NULL OR p.country = %(country)s)
"""

_GROUP_SQL = """
SELECT {column}, count(*),
       sum(coalesce(o.parcel_area_ha, p.estimated_area_ha))
FROM pes_parcels p
LEFT JOIN pes_rs_objects o
  ON o.object_id = p.application_id AND o.object_type = 'application'
WHERE {column} IS NOT NULL
  AND (%(country)s::text IS NULL OR p.country = %(country)s)
GROUP BY {column} ORDER BY count(*) DESC, {column}
"""

_MONTH_SQL = """
SELECT to_char(date_trunc('month', application_date), 'YYYY-MM') AS month, count(*)
FROM pes_parcels p
WHERE (%(country)s::text IS NULL OR p.country = %(country)s)
GROUP BY 1 ORDER BY 1
"""

_GOV_SQL = f"""
SELECT layer, count(*), sum(area_calc_ha)
FROM gov_areas WHERE {_PRODUCTION_FILTER}
GROUP BY layer
"""


def _groups(conn, column: str, country: str | None) -> list[dict]:
    rows = conn.execute(_GROUP_SQL.format(column=column), {"country": country}).fetchall()
    return [{"name": r[0], "applications": r[1], "area_ha": r[2]} for r in rows]


@router.get("/api/dashboard", response_model=DashboardOut)
def dashboard(
    country: str | None = None,
    conn=Depends(get_conn),
    user: Principal = CurrentUser,
) -> DashboardOut:
    t = conn.execute(_TOTALS_SQL, {"country": country}).fetchone()
    months = conn.execute(_MONTH_SQL, {"country": country}).fetchall()
    gov = {r[0]: r for r in conn.execute(_GOV_SQL).fetchall()}
    docs = conn.execute("SELECT count(*) FROM gov_documents WHERE retired = 0").fetchone()[0]
    return DashboardOut(
        pes={
            "applications": t[0],
            "parcel_area_ha": t[1],
            "tree_cover_ha": t[2],
            "visits": t[3],
            "status_counts": {"ok": t[4], "partial": t[5], "partial_final": t[6]},
            "by_country": _groups(conn, "p.country", country),
            "by_activity": _groups(conn, "p.pes_activity", country),
            "by_month": [{"month": m[0], "applications": m[1]} for m in months],
        },
        governance={
            "by_layer": [
                {
                    "layer": layer,
                    "count": gov[layer][1] if layer in gov else 0,
                    "area_ha": gov[layer][2] if layer in gov else None,
                }
                for layer in GOV_LAYERS
            ],
            "documents": docs,
        },
    )
