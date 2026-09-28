"""Run orchestration — spec §4 workflow and §5 autonomous operation.

The scheduled entrypoint (Cloud Scheduler, 20-minute cadence). Fetch,
normalisation, parcel resolution and indicator computation are wired; the
PostGIS persistence layer (results/queue/exceptions/parcel cache, run lock,
incremental selection against stored geom hashes) is the remaining P1 piece
and is marked below.
"""

import logging
from dataclasses import dataclass, field
from datetime import UTC, date, datetime

from .compute import IndicatorBackend, compute_indicators
from .config import PipelineConfig
from .geometry import resolve_geom_source
from .models import IndicatorRow, ObjectType, PesObject
from .pes_api import PesApiClient, normalize_application, normalize_visit

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
) -> None:
    """Spec §4 steps 4–7 for a batch of normalised objects."""
    parents = {
        o.application_id: o for o in objects if o.object_type is ObjectType.APPLICATION
    }
    today = today or date.today()

    for obj in objects:
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


def run_once(config: PipelineConfig, backend: IndicatorBackend | None = None) -> dict:
    """One scheduled run. Returns the health-row payload (spec §6.5).

    Remaining P1 wiring (PostGIS): run lock (pg_advisory_lock, spec §5),
    incremental selection via stored geom_input_hash + processed dates,
    persisting rows/exceptions/queue/parcel cache, and the time budget
    (config.max_run_minutes) checked between objects.
    """
    result = RunResult(start_utc=datetime.now(UTC))

    client = PesApiClient(config)
    try:
        applications = client.fetch_applications()
        visits = client.fetch_monitoring_visits()
    finally:
        client.close()
    result.fetched_app, result.fetched_mon = len(applications), len(visits)

    objects, bad = normalize_all(applications, visits)
    result.exceptions.extend(bad)

    if backend is None:
        from .indicators.gee import GeeBackend

        backend = GeeBackend(config)
    process_objects(objects, backend, config, result)

    return result.health_row()


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    print(run_once(PipelineConfig()))


if __name__ == "__main__":
    main()
