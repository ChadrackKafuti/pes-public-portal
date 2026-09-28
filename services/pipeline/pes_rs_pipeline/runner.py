"""Run orchestration — spec §4 workflow and §5 autonomous operation.

The scheduled entrypoint (Cloud Scheduler, 20-minute cadence): advisory run
lock, incremental selection against stored state, fetch, normalisation,
parcel resolution (with the cached-parent fallback), indicator computation
under the wall-clock budget, and persistence of every output table.
"""

import logging
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta

from .compute import IndicatorBackend, compute_indicators
from .config import PipelineConfig
from .geometry import resolve_geom_source
from .models import IndicatorRow, ObjectType, PesObject
from .pes_api import PesApiClient, normalize_application, normalize_visit
from .selection import Decision, decide

log = logging.getLogger(__name__)


@dataclass
class RunResult:
    """Feeds one pes_rs_runs health row (spec §6.5)."""

    start_utc: datetime
    rows: list[IndicatorRow] = field(default_factory=list)
    exceptions: list[tuple[str, str]] = field(default_factory=list)  # (object_id, reason)
    deferred: list[str] = field(default_factory=list)  # future visits (spec §1)
    fetched_app: int = 0
    fetched_mon: int = 0
    stopped_reason: str = "completed"

    def health_row(self) -> dict:
        end = datetime.now(UTC)
        return {
            "start_utc": self.start_utc.isoformat(),
            "end_utc": end.isoformat(),
            "duration_s": (end - self.start_utc).total_seconds(),
            "fetched_app": self.fetched_app,
            "fetched_mon": self.fetched_mon,
            "selected": len(self.rows) + len(self.exceptions),
            "ok": sum(1 for r in self.rows if not r.failed_indicators),
            "partial": sum(1 for r in self.rows if r.failed_indicators),
            "skipped": len(self.exceptions),
            "queued": len(self.deferred),
            "stopped_reason": self.stopped_reason,
        }


def normalize_all(
    applications: list[dict], visits: list[dict]
) -> tuple[list[PesObject], list[tuple[str, str]]]:
    """Spec §4 step 3: raw records -> PesObjects + exception reasons."""
    objects: list[PesObject] = []
    exceptions: list[tuple[str, str]] = []
    app_dates: dict[str, date] = {}

    for record in applications:
        try:
            obj = normalize_application(record)
            objects.append(obj)
            app_dates[obj.application_id] = obj.application_date
        except Exception as exc:  # noqa: BLE001
            exceptions.append((str(record.get("id", "?")), str(exc) or "bad_record"))

    for record in visits:
        try:
            objects.append(normalize_visit(record, app_dates))
        except Exception as exc:  # noqa: BLE001
            exceptions.append((str(record.get("id", "?")), str(exc) or "bad_record"))

    return objects, exceptions


def process_objects(
    objects: list[PesObject],
    backend: IndicatorBackend,
    config: PipelineConfig,
    result: RunResult,
    *,
    today: date | None = None,
    cached_parents: dict[str, PesObject] | None = None,
    deadline: datetime | None = None,
) -> None:
    """Spec §4 steps 4–7 for a batch of normalised objects.

    `cached_parents` supplies application parcels from pes_parcels for visits
    whose parent was not in this fetch (spec §6.4). `deadline` is the
    wall-clock budget (spec §5): unfinished objects are simply left for the
    next run, which reselects them.
    """
    parents = dict(cached_parents or {})
    parents.update(
        {o.application_id: o for o in objects if o.object_type is ObjectType.APPLICATION}
    )
    today = today or date.today()

    for obj in objects:
        if deadline is not None and datetime.now(UTC) >= deadline:
            result.stopped_reason = "time_budget"
            break
        # Defer future monitoring visits until their object date (spec §1).
        if obj.object_type is ObjectType.MONITORING_VISIT and obj.object_date > today:
            result.deferred.append(obj.object_id)
            continue

        resolved = resolve_geom_source(obj, parents.get(obj.application_id))
        if resolved is None:
            result.exceptions.append((obj.object_id, "no_usable_geometry"))
            continue
        source, bearer = resolved

        # Area guard (spec §8 max_area_ha) using the cheap estimate available
        # pre-computation; the geodesic area lands in the row itself.
        estimate = bearer.estimated_area_ha
        if estimate is not None and estimate > config.max_area_ha:
            result.exceptions.append((obj.object_id, "oversize_gt_5000ha"))
            continue

        try:
            row = compute_indicators(obj, bearer, source, backend, config, today=today)
        except Exception:  # noqa: BLE001
            log.exception("object %s failed", obj.object_id)
            result.exceptions.append((obj.object_id, "own_failed"))
            continue
        if row.parcel_area_ha > config.max_area_ha:
            result.exceptions.append((obj.object_id, "oversize_gt_5000ha"))
            continue
        result.rows.append(row)


def run_once(
    config: PipelineConfig,
    backend: IndicatorBackend | None = None,
    store=None,
) -> dict:
    """One scheduled run (spec §4 + §5). Returns the health-row payload.

    Without a store (local experiments) it computes and returns; with one, it
    takes the advisory run lock, selects incrementally, persists every output
    table and writes the run-health row.
    """
    if store is None:
        from .store import Store

        store = Store(config.database_url)

    result = RunResult(start_utc=datetime.now(UTC))
    with store.connection() as conn:
        if not store.try_acquire_lock(conn):
            log.info("another run holds the lock; skipping (spec §5)")
            result.stopped_reason = "lock_held"
            return result.health_row()
        try:
            client = PesApiClient(config)
            try:
                applications = client.fetch_applications()
                visits = client.fetch_monitoring_visits()
            finally:
                client.close()
            result.fetched_app, result.fetched_mon = len(applications), len(visits)

            objects, bad = normalize_all(applications, visits)
            result.exceptions.extend(bad)

            # Incremental selection (spec §3): keep only objects with work due.
            today = date.today()
            stored = store.load_state(conn, [o.object_id for o in objects])
            objects = [
                o
                for o in objects
                if decide(o, stored.get(o.object_id), config, today) is Decision.PROCESS
            ]

            # Cached parents for visits whose application is not in this batch.
            missing_parents = {
                o.application_id
                for o in objects
                if o.object_type is ObjectType.MONITORING_VISIT
            } - {o.application_id for o in objects if o.object_type is ObjectType.APPLICATION}
            cached_parents = store.load_parent_parcels(conn, sorted(missing_parents))

            if backend is None:
                from .indicators.gee import GeeBackend

                backend = GeeBackend(config)

            deadline = result.start_utc + timedelta(minutes=config.max_run_minutes)
            process_objects(
                objects,
                backend,
                config,
                result,
                today=today,
                cached_parents=cached_parents,
                deadline=deadline,
            )

            store.upsert_parcels(
                conn,
                [o for o in objects if o.object_type is ObjectType.APPLICATION],
            )
            store.upsert_rows(
                conn, result.rows, stored, max_partial_retries=config.max_partial_retries
            )
            store.sync_queue(
                conn,
                result.rows,
                [o for o in objects if o.object_id in set(result.deferred)],
                today=today,
            )
            store.record_exceptions(conn, result.exceptions)
            store.insert_run(conn, result.health_row())
            conn.commit()
        finally:
            store.release_lock(conn)

    return result.health_row()


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    print(run_once(PipelineConfig()))


if __name__ == "__main__":
    main()
