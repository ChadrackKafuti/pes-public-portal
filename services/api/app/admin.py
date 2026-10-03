"""Admin follow-up (M20): the parcels the pipeline skipped or failed.

One grouped view over pes_rs_exceptions — oversize parcels (> 5,000 ha),
unusable geometries, failed indicator computations and failed annual /
land-cover analyses — so someone can chase the source data. Hidden records
(archived, rejected, QA tenants) are left out: they are skipped on purpose.
"""

from fastapi import APIRouter, Depends, Query

from .auth import CurrentUser, Principal
from .db import get_conn
from .schemas import AdminExceptionItem, AdminExceptionsOut
from .visibility import hidden_application_ids

router = APIRouter()

_SQL = """
SELECT e.object_id, max(e.object_type::text) AS object_type, e.reason,
       max(e.area_gis) AS area_gis, count(*) AS occurrences,
       max(e.run_utc) AS last_seen,
       max(p.application_code) AS application_code,
       max(p.implementing_org) AS implementing_org,
       max(p.country) AS country,
       max(o.application_id) AS via_application
FROM pes_rs_exceptions e
LEFT JOIN pes_parcels p ON p.application_id = e.object_id
LEFT JOIN pes_rs_objects o ON o.object_id = e.object_id
GROUP BY e.object_id, e.reason
ORDER BY max(e.run_utc) DESC
"""


@router.get("/api/admin/exceptions", response_model=AdminExceptionsOut)
def admin_exceptions(
    limit: int = Query(500, ge=1, le=2000),
    conn=Depends(get_conn),
    user: Principal = CurrentUser,
) -> AdminExceptionsOut:
    hidden = hidden_application_ids(conn)
    rows = conn.execute(_SQL).fetchall()
    items = []
    summary: dict[str, int] = {}
    for r in rows:
        object_id, object_type, reason = str(r[0]), r[1], r[2]
        app_id = object_id if r[6] is not None else (r[9] and str(r[9]))
        if object_id in hidden or (app_id and str(app_id) in hidden):
            continue  # hidden on purpose: not follow-up material
        summary[reason] = summary.get(reason, 0) + 1
        if len(items) < limit:
            items.append(
                AdminExceptionItem(
                    object_id=object_id,
                    object_type=object_type,
                    reason=reason,
                    area_gis=r[3],
                    occurrences=r[4],
                    last_seen=r[5],
                    application_code=r[6],
                    implementing_org=r[7],
                    country=r[8],
                )
            )
    return AdminExceptionsOut(
        summary=[
            {"reason": k, "objects": v}
            for k, v in sorted(summary.items(), key=lambda kv: -kv[1])
        ],
        items=items,
    )
