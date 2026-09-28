"""Postgres persistence — spec §5 (lock) and §6 (output tables).

Plain psycopg + SQL against the schema in infra/db/init/001_core.sql.
The run lock is a Postgres advisory lock (spec §6 note): session-scoped, so
a crashed run releases it automatically — the TTL concern of the SDE lock
table disappears.
"""

from contextlib import contextmanager
from datetime import date, datetime, timedelta

from .geometry import geom_input_hash
from .models import IndicatorRow, PesObject, Status
from .selection import StoredState

RUN_LOCK_KEY = 0x_CAF1_25  # arbitrary constant shared by all pipeline instances


class Store:
    def __init__(self, database_url: str):
        self._url = database_url

    @contextmanager
    def connection(self):
        import psycopg

        with psycopg.connect(self._url) as conn:
            yield conn

    # -- run lock (spec §5) ----------------------------------------------

    def try_acquire_lock(self, conn) -> bool:
        row = conn.execute("SELECT pg_try_advisory_lock(%s)", (RUN_LOCK_KEY,)).fetchone()
        return bool(row[0])

    def release_lock(self, conn) -> None:
        conn.execute("SELECT pg_advisory_unlock(%s)", (RUN_LOCK_KEY,))

    # -- incremental state (spec §3) --------------------------------------

    def load_state(self, conn, object_ids: list[str]) -> dict[str, StoredState]:
        if not object_ids:
            return {}
        rows = conn.execute(
            """
            SELECT o.object_id, o.geom_input_hash, o.object_date, o.status,
                   o.attempts, q.next_attempt_date
            FROM pes_rs_objects o
            LEFT JOIN pes_rs_queue q USING (object_id)
            WHERE o.object_id = ANY(%s)
            """,
            (object_ids,),
        ).fetchall()
        return {
            r[0]: StoredState(
                geom_input_hash=r[1],
                object_date=r[2],
                status=Status(r[3]),
                attempts=r[4],
                next_attempt_date=r[5],
            )
            for r in rows
        }

    # -- writes (spec §6) -------------------------------------------------

    def upsert_rows(
        self,
        conn,
        rows: list[IndicatorRow],
        prior: dict[str, StoredState],
        *,
        max_partial_retries: int,
    ) -> None:
        for row in rows:
            attempts = row.attempts
            stored = prior.get(row.object_id)
            if row.status is Status.PARTIAL:
                # Count attempts only across retries of the SAME inputs.
                same = stored is not None and stored.geom_input_hash == row.geom_input_hash
                attempts = (stored.attempts + 1) if same else 1
                row.attempts = attempts
                if attempts >= max_partial_retries:
                    row.status = Status.PARTIAL_FINAL
            conn.execute(
                """
                INSERT INTO pes_rs_objects (
                  object_id, object_type, object_date, application_id,
                  application_code, contract_code, pes_activity,
                  parcel_area_ha, tree_cover_ha, defor_5yr_ha_yr, defor_current_ha,
                  defor_alerts_5yr, defor_alerts_current, fire_alerts_5yr,
                  fire_alerts_current, burned_area_5yr_ha, burned_area_current_ha,
                  current_start, geom_source, tc_window_days, tc_coverage,
                  baseline_years, status, failed_indicators, attempts,
                  geom_input_hash, processed_utc
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                          %s,%s,%s,%s,%s,%s, now())
                ON CONFLICT (object_id) DO UPDATE SET
                  object_type = EXCLUDED.object_type,
                  object_date = EXCLUDED.object_date,
                  application_id = EXCLUDED.application_id,
                  application_code = EXCLUDED.application_code,
                  contract_code = EXCLUDED.contract_code,
                  pes_activity = EXCLUDED.pes_activity,
                  parcel_area_ha = EXCLUDED.parcel_area_ha,
                  tree_cover_ha = EXCLUDED.tree_cover_ha,
                  defor_5yr_ha_yr = EXCLUDED.defor_5yr_ha_yr,
                  defor_current_ha = EXCLUDED.defor_current_ha,
                  defor_alerts_5yr = EXCLUDED.defor_alerts_5yr,
                  defor_alerts_current = EXCLUDED.defor_alerts_current,
                  fire_alerts_5yr = EXCLUDED.fire_alerts_5yr,
                  fire_alerts_current = EXCLUDED.fire_alerts_current,
                  burned_area_5yr_ha = EXCLUDED.burned_area_5yr_ha,
                  burned_area_current_ha = EXCLUDED.burned_area_current_ha,
                  current_start = EXCLUDED.current_start,
                  geom_source = EXCLUDED.geom_source,
                  tc_window_days = EXCLUDED.tc_window_days,
                  tc_coverage = EXCLUDED.tc_coverage,
                  baseline_years = EXCLUDED.baseline_years,
                  status = EXCLUDED.status,
                  failed_indicators = EXCLUDED.failed_indicators,
                  attempts = EXCLUDED.attempts,
                  geom_input_hash = EXCLUDED.geom_input_hash,
                  processed_utc = now()
                """,
                (
                    row.object_id, row.object_type.value, row.object_date,
                    row.application_id, row.application_code, row.contract_code,
                    row.pes_activity, row.parcel_area_ha, row.tree_cover_ha,
                    row.defor_5yr_ha_yr, row.defor_current_ha, row.defor_alerts_5yr,
                    row.defor_alerts_current, row.fire_alerts_5yr,
                    row.fire_alerts_current, row.burned_area_5yr_ha,
                    row.burned_area_current_ha, row.current_start,
                    row.geom_source.value, row.tc_window_days, row.tc_coverage,
                    row.baseline_years, row.status.value, row.failed_indicators,
                    attempts, row.geom_input_hash,
                ),
            )

    def sync_queue(
        self,
        conn,
        rows: list[IndicatorRow],
        deferred: list[PesObject],
        *,
        today: date,
        retry_backoff_days: int = 1,
    ) -> None:
        """Queue = deferred future visits + pending partial retries (spec §6.3)."""
        for obj in deferred:
            conn.execute(
                """
                INSERT INTO pes_rs_queue
                  (object_id, object_type, object_date, status, geom_input_hash,
                   next_attempt_date, reason)
                VALUES (%s,%s,%s,'deferred_future',%s,%s,'future_object_date')
                ON CONFLICT (object_id) DO UPDATE SET
                  object_date = EXCLUDED.object_date,
                  next_attempt_date = EXCLUDED.next_attempt_date,
                  status = 'deferred_future'
                """,
                (
                    obj.object_id, obj.object_type.value, obj.object_date,
                    geom_input_hash(obj.shape_wkt, obj.point), obj.object_date,
                ),
            )
        for row in rows:
            if row.status is Status.PARTIAL:
                conn.execute(
                    """
                    INSERT INTO pes_rs_queue
                      (object_id, object_type, object_date, status, attempts,
                       geom_input_hash, next_attempt_date, reason)
                    VALUES (%s,%s,%s,'retry_partial',%s,%s,%s,%s)
                    ON CONFLICT (object_id) DO UPDATE SET
                      attempts = EXCLUDED.attempts,
                      next_attempt_date = EXCLUDED.next_attempt_date,
                      status = 'retry_partial',
                      reason = EXCLUDED.reason
                    """,
                    (
                        row.object_id, row.object_type.value, row.object_date,
                        row.attempts, row.geom_input_hash,
                        today + timedelta(days=retry_backoff_days),
                        ",".join(row.failed_indicators),
                    ),
                )
            else:  # done (ok or partial_final): leave the queue
                conn.execute(
                    "DELETE FROM pes_rs_queue WHERE object_id = %s", (row.object_id,)
                )

    def record_exceptions(self, conn, exceptions: list[tuple[str, str]]) -> None:
        for object_id, reason in exceptions:
            conn.execute(
                """
                INSERT INTO pes_rs_exceptions (object_id, object_type, reason)
                VALUES (%s, 'application', %s)
                """,
                (object_id, reason),
            )

    def upsert_parcels(self, conn, applications: list[PesObject]) -> None:
        """Spec §6.4: cache application geometry inputs so later runs' visits
        can inherit the parent parcel."""
        for app in applications:
            lon, lat = app.point if app.point else (None, None)
            conn.execute(
                """
                INSERT INTO pes_parcels
                  (application_id, application_code, contract_code, application_date,
                   shape_raw, point_lon, point_lat,
                   estimated_area_ha, pes_activity, geom_input_hash, updated_utc)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, now())
                ON CONFLICT (application_id) DO UPDATE SET
                  application_code = EXCLUDED.application_code,
                  contract_code = EXCLUDED.contract_code,
                  application_date = EXCLUDED.application_date,
                  shape_raw = EXCLUDED.shape_raw,
                  point_lon = EXCLUDED.point_lon,
                  point_lat = EXCLUDED.point_lat,
                  estimated_area_ha = EXCLUDED.estimated_area_ha,
                  pes_activity = EXCLUDED.pes_activity,
                  geom_input_hash = EXCLUDED.geom_input_hash,
                  updated_utc = now()
                """,
                (
                    app.application_id, app.application_code, app.contract_code,
                    app.application_date, app.shape_wkt,
                    lon, lat, app.estimated_area_ha, app.pes_activity,
                    geom_input_hash(app.shape_wkt, app.point),
                ),
            )

    def insert_run(self, conn, health: dict) -> None:
        conn.execute(
            """
            INSERT INTO pes_rs_runs
              (start_utc, end_utc, duration_s, fetched_app, fetched_mon,
               selected, ok, partial, skipped, queued, stopped_reason)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            (
                health["start_utc"], health["end_utc"], health["duration_s"],
                health["fetched_app"], health["fetched_mon"], health["selected"],
                health["ok"], health["partial"], health["skipped"],
                health["queued"], health["stopped_reason"],
            ),
        )

    def load_parent_parcels(self, conn, application_ids: list[str]) -> dict[str, PesObject]:
        """Cached parents for visits whose application wasn't in this fetch."""
        from .models import ObjectType

        if not application_ids:
            return {}
        rows = conn.execute(
            """
            SELECT application_id, application_code, contract_code, application_date,
                   shape_raw, point_lon, point_lat, estimated_area_ha, pes_activity
            FROM pes_parcels WHERE application_id = ANY(%s)
            """,
            (application_ids,),
        ).fetchall()
        def _text(v):
            # psycopg returns text as bytes under a SQL_ASCII server encoding
            return v.decode("utf-8", errors="replace") if isinstance(v, bytes) else v

        return {
            _text(r[0]): PesObject(
                object_id=_text(r[0]),
                object_type=ObjectType.APPLICATION,
                object_date=r[3],
                application_date=r[3],
                application_id=r[0],
                application_code=_text(r[1]),
                contract_code=_text(r[2]),
                pes_activity=_text(r[8]),
                shape_wkt=_text(r[4]),
                point=(r[5], r[6]) if r[5] is not None else None,
                estimated_area_ha=r[7],
            )
            for r in rows
        }
