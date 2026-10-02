"""Jurisdictional dashboard aggregates (design doc M5).

One payload feeds the whole dashboard page: PES programme totals and
breakdowns (optionally narrowed to a country) plus the basin-wide
forest-governance inventory. Blank-is-not-zero carries through: sums of
NULL indicator values stay NULL, never 0.
"""

from collections import Counter

from fastapi import APIRouter, Depends

from .auth import CurrentUser, Principal
from .db import get_conn
from .profile import _fire_category, _int, _pick, _stage
from .visibility import application_hidden, hidden_application_ids
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
          AND (%(country)s::text IS NULL OR vp.country = %(country)s)
          AND NOT (v.application_id = ANY(%(hidden)s))),
       count(*) FILTER (WHERE o.status = 'ok'),
       count(*) FILTER (WHERE o.status = 'partial'),
       count(*) FILTER (WHERE o.status = 'partial_final')
FROM pes_parcels p
LEFT JOIN pes_rs_objects o
  ON o.object_id = p.application_id AND o.object_type = 'application'
WHERE (%(country)s::text IS NULL OR p.country = %(country)s)
  AND NOT (p.application_id = ANY(%(hidden)s))
"""

_GROUP_SQL = """
SELECT {column}, count(*),
       sum(coalesce(o.parcel_area_ha, p.estimated_area_ha))
FROM pes_parcels p
LEFT JOIN pes_rs_objects o
  ON o.object_id = p.application_id AND o.object_type = 'application'
WHERE {column} IS NOT NULL
  AND (%(country)s::text IS NULL OR p.country = %(country)s)
  AND NOT (p.application_id = ANY(%(hidden)s))
GROUP BY {column} ORDER BY count(*) DESC, {column}
"""

_MONTH_SQL = """
SELECT to_char(date_trunc('month', application_date), 'YYYY-MM') AS month, count(*)
FROM pes_parcels p
WHERE (%(country)s::text IS NULL OR p.country = %(country)s)
  AND NOT (p.application_id = ANY(%(hidden)s))
GROUP BY 1 ORDER BY 1
"""

_PROFILE_SQL = """
SELECT r.payload, o.burned_area_5yr_ha, o.parcel_area_ha
FROM pes_raw_records r
JOIN pes_parcels p ON p.application_id = r.record_id
LEFT JOIN pes_rs_objects o
  ON o.object_id = p.application_id AND o.object_type = 'application'
WHERE r.kind = 'application'
  AND (%(country)s::text IS NULL OR p.country = %(country)s)
"""


def _profile_aggregates(conn, country: str | None) -> dict:
    """v1 country-overview figures, derived from the raw payload mirror:
    stage pipeline, beneficiary gender split, fire-risk profile and the
    overdue-monitoring count. Empty when no raw records are mirrored yet."""
    stages: Counter[tuple[int | None, str]] = Counter()
    genders: Counter[str] = Counter()
    fire: Counter[str] = Counter()
    overdue = 0
    rows = conn.execute(_PROFILE_SQL, {"country": country}).fetchall()
    rows = [r for r in rows if not application_hidden(r[0])]  # M14
    for payload, burned_ha, parcel_ha in rows:
        stage = _stage(payload)
        if stage is not None and (stage.name or stage.status):
            stages[(stage.order, str(stage.name or stage.status))] += 1
        gender = _pick(payload, ["beneficiarygender", "gender"])
        if gender:
            genders[str(gender)] += 1
        burned_pct = (
            burned_ha / parcel_ha * 100 if burned_ha is not None and parcel_ha else None
        )
        category = _fire_category(burned_pct)
        if category is not None:
            fire[category] += 1
        if bool(_int(_pick(payload, ["monitoringoverdue"]))):
            overdue += 1
    return {
        "by_stage": [
            {"name": name, "order": order, "applications": n}
            for (order, name), n in sorted(
                stages.items(), key=lambda kv: (kv[0][0] is None, kv[0][0], kv[0][1])
            )
        ],
        "by_gender": [
            {"name": g, "applications": n}
            for g, n in sorted(genders.items(), key=lambda kv: (-kv[1], kv[0]))
        ],
        "fire_profile": [
            {"name": c, "applications": fire[c]}
            for c in ("low", "moderate", "high", "very_high")
            if c in fire
        ],
        "overdue": overdue if rows else None,
    }


_GOV_SQL = f"""
SELECT layer, count(*), sum(area_calc_ha)
FROM gov_areas WHERE {_PRODUCTION_FILTER}
GROUP BY layer
"""


def _groups(conn, column: str, country: str | None, hidden: list[str]) -> list[dict]:
    rows = conn.execute(
        _GROUP_SQL.format(column=column), {"country": country, "hidden": hidden}
    ).fetchall()
    return [{"name": r[0], "applications": r[1], "area_ha": r[2]} for r in rows]


@router.get("/api/dashboard", response_model=DashboardOut)
def dashboard(
    country: str | None = None,
    conn=Depends(get_conn),
    user: Principal = CurrentUser,
) -> DashboardOut:
    hidden = sorted(hidden_application_ids(conn))  # archived/deleted (M14)
    params = {"country": country, "hidden": hidden}
    t = conn.execute(_TOTALS_SQL, params).fetchone()
    months = conn.execute(_MONTH_SQL, params).fetchall()
    gov = {r[0]: r for r in conn.execute(_GOV_SQL).fetchall()}
    docs = conn.execute("SELECT count(*) FROM gov_documents WHERE retired = 0").fetchone()[0]
    return DashboardOut(
        pes={
            "applications": t[0],
            "parcel_area_ha": t[1],
            "tree_cover_ha": t[2],
            "visits": t[3],
            "status_counts": {"ok": t[4], "partial": t[5], "partial_final": t[6]},
            "by_country": _groups(conn, "p.country", country, hidden),
            "by_activity": _groups(conn, "p.pes_activity", country, hidden),
            "by_month": [{"month": m[0], "applications": m[1]} for m in months],
            **_profile_aggregates(conn, country),
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
