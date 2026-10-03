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
from .pes_api import PesApiClient, _pick, normalize_application, normalize_visit
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
    selected: int | None = None  # objects entering processing after selection
    stopped_reason: str = "completed"

    def health_row(self) -> dict:
        end = datetime.now(UTC)
        return {
            "start_utc": self.start_utc.isoformat(),
            "end_utc": end.isoformat(),
            "duration_s": (end - self.start_utc).total_seconds(),
            "fetched_app": self.fetched_app,
            "fetched_mon": self.fetched_mon,
            "selected": (
                self.selected
                if self.selected is not None
                else len(self.rows) + len(self.exceptions)
            ),
            "ok": sum(1 for r in self.rows if not r.failed_indicators),
            "partial": sum(1 for r in self.rows if r.failed_indicators),
            "skipped": len(self.exceptions),
            "queued": len(self.deferred),
            "stopped_reason": self.stopped_reason,
        }


def normalize_all(
    applications: list[dict],
    visits: list[dict],
    cached_parent_dates: dict[str, date] | None = None,
) -> tuple[list[PesObject], list[tuple[str, str]]]:
    """Spec §4 step 3: raw records -> PesObjects + exception reasons.

    `cached_parent_dates` supplies application dates from the pes_parcels
    cache (spec §6.4), so a visit still normalizes when its parent
    application is not part of this fetch. Fetched applications win over
    the cache.
    """
    objects: list[PesObject] = []
    exceptions: list[tuple[str, str]] = []
    app_dates: dict[str, date] = dict(cached_parent_dates or {})

    for record in applications:
        try:
            obj = normalize_application(record)
            objects.append(obj)
            app_dates[obj.application_id] = obj.application_date
        except Exception as exc:  # noqa: BLE001
            rid = _pick(record, "id")
            exceptions.append((str(rid) if rid is not None else "?", str(exc) or "bad_record"))

    for record in visits:
        try:
            objects.append(normalize_visit(record, app_dates))
        except Exception as exc:  # noqa: BLE001
            rid = _pick(record, "visit_id")
            exceptions.append((str(rid) if rid is not None else "?", str(exc) or "bad_record"))

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

            # M7a: raw-payload mirror + geotagged photos. Runs right after the
            # fetch because the photo URLs carry short-lived SAS tokens; its
            # own small budget keeps the indicator loop's time intact, and a
            # failure here never blocks indicator processing.
            try:
                from .photos import sync_photos

                photo_stats = sync_photos(conn, config, applications, visits)
                conn.commit()
                log.info("photos: %s", photo_stats)
            except Exception:  # noqa: BLE001
                conn.rollback()
                log.exception("photo sync failed; continuing with indicators")

            # Cached parents (spec §6.4) BEFORE normalisation: visits whose
            # parent application is not part of this fetch must still resolve
            # their baseline date and inherit the cached parcel.
            fetched_ids = {
                str(_pick(a, "id")) for a in applications if _pick(a, "id") is not None
            }
            referenced = {
                str(_pick(v, "application_ref"))
                for v in visits
                if _pick(v, "application_ref") is not None
            }
            cached_parents = store.load_parent_parcels(
                conn, sorted(referenced - fetched_ids)
            )
            cached_dates = {
                pid: parent.application_date for pid, parent in cached_parents.items()
            }

            # M20: archived/deleted/rejected records and QA tenants never
            # enter computation; the raw mirror above keeps their payloads
            # so the API's own visibility filter stays authoritative.
            from .visibility import split_visible

            applications, visits, hidden_ids = split_visible(applications, visits)
            log.info("visibility: hidden=%d", len(hidden_ids))

            # M26: Claude vision pass over newly mirrored photos, in its own
            # small budget. Disabled until the API key secret is configured.
            try:
                from .photos_ai import process_photo_ai

                ai_stats = process_photo_ai(conn, config, hidden_ids=hidden_ids)
                conn.commit()
                log.info("photo-ai: %s", ai_stats)
            except Exception:  # noqa: BLE001
                conn.rollback()
                log.exception("photo-ai pass failed; run continues")

            objects, bad = normalize_all(applications, visits, cached_dates)
            result.exceptions.extend(bad)
            # Every fetched application refreshes the parcel cache, selected
            # for indicator work or not (M13): the API's points/filters read
            # pes_parcels, so parse fixes (e.g. new Point formats) must reach
            # already-processed records too. Cheap: hash-guarded upsert only.
            all_applications = [
                o for o in objects if o.object_type is ObjectType.APPLICATION
            ]

            # Incremental selection (spec §3): keep only objects with work due.
            today = date.today()
            stored = store.load_state(conn, [o.object_id for o in objects])
            objects = [
                o
                for o in objects
                if decide(o, stored.get(o.object_id), config, today) is Decision.PROCESS
            ]
            result.selected = len(objects)

            if backend is None:
                from .indicators.gee import GeeBackend

                backend = GeeBackend(config)

            # The run's hard deadline; the main loop stops early by the
            # annual reserve (M15) and the NRT reserve (M23) so neither
            # pass is ever starved by a large main backlog.
            deadline = result.start_utc + timedelta(minutes=config.max_run_minutes)
            reserved = config.annual_reserve_minutes + config.nrt_reserve_minutes
            main_deadline = min(
                deadline,
                result.start_utc
                + timedelta(minutes=max(1, config.max_run_minutes - reserved)),
            )
            nrt_deadline = min(
                deadline,
                main_deadline + timedelta(minutes=config.nrt_reserve_minutes),
            )
            process_objects(
                objects,
                backend,
                config,
                result,
                today=today,
                cached_parents=cached_parents,
                deadline=main_deadline,
            )

            store.upsert_parcels(conn, all_applications)
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
            conn.commit()

            # M23: near-real-time incident checks in their reserved slice.
            try:
                from .indicators.nrt import process_nrt

                nrt_stats = process_nrt(
                    conn, backend, config, nrt_deadline, today, hidden_ids=hidden_ids
                )
                log.info("nrt: %s", nrt_stats)
            except Exception:  # noqa: BLE001
                conn.rollback()
                log.exception("nrt incident pass failed; run continues")

            # M7d: annual tree-cover series + land-cover classes, in whatever
            # time the run has left. Failures never cost the run.
            try:
                from .indicators.annual import process_annual
                from .pes_api import _pick as _api_pick

                # M22: applications a monitoring visit links to a contract are
                # the only ones the Analyses page can surface — their series
                # jump the queue ahead of the contract-less backlog.
                contract_linked = {
                    str(_api_pick(v, "application_ref"))
                    for v in visits
                    if isinstance(v, dict)
                    and _api_pick(v, "application_ref") is not None
                    and str(_api_pick(v, "contract_code") or "").strip()
                }
                annual_stats = process_annual(
                    conn, backend, config, deadline, today,
                    hidden_ids=hidden_ids, priority_ids=contract_linked,
                )
                log.info("annual: %s", annual_stats)
            except Exception:  # noqa: BLE001
                conn.rollback()
                log.exception("annual indicator pass failed; run continues")

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
