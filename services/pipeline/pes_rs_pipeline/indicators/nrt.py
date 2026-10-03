"""Near-real-time incidents (M23) — the monitoring instrument's pulse.

Each run spends a small reserved slice re-checking parcels for RADD
deforestation alerts and VIIRS fire detections over a short recent
window. Detections become stateful incidents: one open incident per
(application, kind) that grows while the signal persists, waits for a
field response (geotagged photo — the M27 loop), and auto-resolves when
the window goes quiet before anyone responded. Parcels rotate
stalest-first, so the whole portfolio refreshes across a day or two of
scheduled runs — matching the latency of the underlying alert systems.
"""

import logging
from datetime import UTC, date, datetime, timedelta

from ..config import PipelineConfig
from ..geometry import resolve_geom_source
from ..windows import Interval
from .annual import _bearer

log = logging.getLogger(__name__)

KIND_DEFORESTATION = "deforestation"
KIND_FIRE = "fire"

_CANDIDATES_SQL = """
SELECT p.application_id, p.shape_raw, p.point_lon, p.point_lat,
       p.estimated_area_ha, p.application_date
FROM pes_parcels p
LEFT JOIN pes_nrt_state s ON s.application_id = p.application_id
WHERE NOT (p.application_id = ANY(%(hidden)s))
  AND (p.shape_raw IS NOT NULL OR p.point_lon IS NOT NULL)
  AND (p.estimated_area_ha IS NULL OR p.estimated_area_ha <= %(max_ha)s)
  AND (s.checked_utc IS NULL OR s.checked_utc < %(stale_before)s)
ORDER BY s.checked_utc ASC NULLS FIRST
LIMIT %(limit)s
"""


def _open_incident(conn, app_id: str, kind: str) -> tuple[str, str] | None:
    row = conn.execute(
        """
        SELECT incident_uid, status FROM pes_incidents
        WHERE application_id = %s AND kind = %s AND status IN ('open', 'responded')
        ORDER BY first_detected DESC LIMIT 1
        """,
        (app_id, kind),
    ).fetchone()
    return (row[0], row[1]) if row else None


def _record_detection(conn, app_id: str, kind: str, count: int, today: date) -> bool:
    """Create or extend the open incident; True when a new one was opened."""
    existing = _open_incident(conn, app_id, kind)
    if existing is not None:
        conn.execute(
            """
            UPDATE pes_incidents
            SET last_detected = %s, magnitude = %s, updated_utc = now()
            WHERE incident_uid = %s
            """,
            (today, float(count), existing[0]),
        )
        return False
    conn.execute(
        """
        INSERT INTO pes_incidents
          (incident_uid, application_id, kind, first_detected, last_detected, magnitude)
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (incident_uid) DO UPDATE SET
          last_detected = EXCLUDED.last_detected,
          magnitude = EXCLUDED.magnitude,
          status = CASE WHEN pes_incidents.status = 'resolved'
                        THEN 'open' ELSE pes_incidents.status END,
          updated_utc = now()
        """,
        (f"{app_id}:{kind}:{today.isoformat()}", app_id, kind, today, today, float(count)),
    )
    return True


def _resolve_quiet(conn, app_id: str, kind: str, window_start: date) -> int:
    """Auto-resolve an OPEN incident whose signal cleared (nothing in the
    current window and the last detection predates it). A 'responded'
    incident stays for human verification."""
    cur = conn.execute(
        """
        UPDATE pes_incidents
        SET status = 'resolved', status_note = 'signal cleared',
            status_utc = now(), updated_utc = now()
        WHERE application_id = %s AND kind = %s AND status = 'open'
          AND last_detected < %s
        """,
        (app_id, kind, window_start),
    )
    return cur.rowcount or 0


def process_nrt(
    conn,
    backend,
    config: PipelineConfig,
    deadline,
    today: date,
    hidden_ids: set[str] | None = None,
) -> dict:
    stale_before = datetime.now(UTC) - timedelta(hours=config.nrt_recheck_hours)
    rows = conn.execute(
        _CANDIDATES_SQL,
        {
            "hidden": sorted(hidden_ids or ()),
            "max_ha": config.max_area_ha,
            "stale_before": stale_before,
            "limit": config.nrt_batch_limit,
        },
    ).fetchall()

    defor_window = Interval(today - timedelta(days=config.nrt_defor_days), today)
    fire_window = Interval(today - timedelta(days=config.nrt_fire_days), today)

    checked = opened = extended = resolved = failed = 0
    for row in rows:
        if datetime.now(UTC) >= deadline:
            break
        app_id = str(row[0])
        try:
            obj = _bearer(row)
            geom = resolve_geom_source(obj, obj)
            if geom is None:
                continue
            source, bearer = geom
            parcel = backend.resolve_parcel(bearer, source)

            defor = backend.radd_alerts(parcel, defor_window)
            fire = backend.fire_alerts(parcel, fire_window)

            for kind, count, window in (
                (KIND_DEFORESTATION, defor, defor_window),
                (KIND_FIRE, fire, fire_window),
            ):
                if count > 0:
                    if _record_detection(conn, app_id, kind, count, today):
                        opened += 1
                    else:
                        extended += 1
                else:
                    resolved += _resolve_quiet(conn, app_id, kind, window.start)

            conn.execute(
                """
                INSERT INTO pes_nrt_state (application_id, checked_utc, defor_alerts, fire_alerts)
                VALUES (%s, now(), %s, %s)
                ON CONFLICT (application_id) DO UPDATE SET
                  checked_utc = now(),
                  defor_alerts = EXCLUDED.defor_alerts,
                  fire_alerts = EXCLUDED.fire_alerts
                """,
                (app_id, defor, fire),
            )
            conn.commit()
            checked += 1
        except Exception:  # noqa: BLE001 — one parcel never sinks the pass
            conn.rollback()
            failed += 1
            log.exception("nrt check failed")
            try:
                conn.execute(
                    """
                    INSERT INTO pes_rs_exceptions (object_id, object_type, reason)
                    VALUES (%s, 'application', 'nrt_failed')
                    """,
                    (app_id,),
                )
                conn.commit()
            except Exception:  # noqa: BLE001
                conn.rollback()
    return {
        "nrt_checked": checked,
        "nrt_opened": opened,
        "nrt_extended": extended,
        "nrt_resolved": resolved,
        "nrt_failed": failed,
        "nrt_stale": len(rows),
    }
