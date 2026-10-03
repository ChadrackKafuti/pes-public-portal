"""Incident feed (M23) — stateful near-real-time disturbance incidents.

The pipeline opens/extends/auto-resolves incidents from RADD and VIIRS
detections; this API lists them (joined with parcel context) and lets a
signed-in monitor move one through the response workflow:
open → responded → verified | dismissed, with reopen for mistakes.
"""

from fastapi import APIRouter, Depends, HTTPException, Query

from .auth import CurrentUser, Principal
from .db import get_conn
from .schemas import IncidentItem, IncidentsOut, IncidentUpdate

router = APIRouter()

_STATUSES = ("open", "responded", "verified", "dismissed", "resolved")
# Target statuses a user may set, per current status.
_TRANSITIONS: dict[str, set[str]] = {
    "open": {"responded", "verified", "dismissed"},
    "responded": {"verified", "dismissed", "open"},
    "verified": {"open"},
    "dismissed": {"open"},
    "resolved": {"open"},
}

_LIST_SQL = """
SELECT i.incident_uid, i.application_id, i.kind, i.first_detected,
       i.last_detected, i.magnitude, i.status, i.status_note, i.status_by,
       i.status_utc, i.updated_utc,
       p.application_code, p.implementing_org, p.project_name,
       p.country, p.province, p.pes_activity
FROM pes_incidents i
JOIN pes_parcels p ON p.application_id = i.application_id
WHERE NOT (i.application_id = ANY(%(hidden)s))
  AND (%(status)s::text IS NULL OR i.status = %(status)s)
  AND (%(kind)s::text IS NULL OR i.kind = %(kind)s)
  AND (%(country)s::text IS NULL OR p.country = %(country)s)
ORDER BY (i.status = 'open') DESC, i.last_detected DESC, i.incident_uid
LIMIT %(limit)s
"""

_FIELDS = [
    "incident_uid", "application_id", "kind", "first_detected",
    "last_detected", "magnitude", "status", "status_note", "status_by",
    "status_utc", "updated_utc",
    "application_code", "implementing_org", "project_name",
    "country", "province", "pes_activity",
]

_SUMMARY_SQL = """
SELECT i.status, count(*)
FROM pes_incidents i
JOIN pes_parcels p ON p.application_id = i.application_id
WHERE NOT (i.application_id = ANY(%(hidden)s))
  AND (%(country)s::text IS NULL OR p.country = %(country)s)
GROUP BY i.status
"""


@router.get("/api/incidents", response_model=IncidentsOut)
def incidents(
    status: str | None = Query(None, pattern="^(open|responded|verified|dismissed|resolved)$"),
    kind: str | None = Query(None, pattern="^(deforestation|fire)$"),
    country: str | None = None,
    limit: int = Query(300, ge=1, le=1000),
    conn=Depends(get_conn),
    user: Principal = CurrentUser,
) -> IncidentsOut:
    from .visibility import hidden_application_ids

    hidden = sorted(hidden_application_ids(conn))
    rows = conn.execute(
        _LIST_SQL,
        {"hidden": hidden, "status": status, "kind": kind,
         "country": country, "limit": limit},
    ).fetchall()
    counts = dict(
        conn.execute(_SUMMARY_SQL, {"hidden": hidden, "country": country}).fetchall()
    )
    return IncidentsOut(
        summary={s: int(counts.get(s, 0)) for s in _STATUSES},
        items=[IncidentItem(**dict(zip(_FIELDS, r, strict=True))) for r in rows],
    )


@router.patch("/api/incidents/{incident_uid}", response_model=IncidentItem)
def update_incident(
    incident_uid: str,
    body: IncidentUpdate,
    conn=Depends(get_conn),
    user: Principal = CurrentUser,
) -> IncidentItem:
    row = conn.execute(
        "SELECT status FROM pes_incidents WHERE incident_uid = %s",
        (incident_uid,),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="unknown incident")
    current = row[0]
    if body.status not in _TRANSITIONS.get(current, set()):
        raise HTTPException(
            status_code=409, detail=f"cannot move {current} to {body.status}"
        )
    conn.execute(
        """
        UPDATE pes_incidents
        SET status = %s, status_note = %s, status_by = %s,
            status_utc = now(), updated_utc = now()
        WHERE incident_uid = %s
        """,
        (body.status, body.note, user.username or user.subject, incident_uid),
    )
    conn.commit()
    out = conn.execute(
        _LIST_SQL.replace(
            "WHERE NOT (i.application_id = ANY(%(hidden)s))",
            "WHERE i.incident_uid = %(uid)s AND NOT (i.application_id = ANY(%(hidden)s))",
        ),
        {"uid": incident_uid, "hidden": [], "status": None, "kind": None,
         "country": None, "limit": 1},
    ).fetchone()
    if out is None:  # pragma: no cover — hidden app raced in
        raise HTTPException(status_code=404, detail="unknown incident")
    return IncidentItem(**dict(zip(_FIELDS, out, strict=True)))
