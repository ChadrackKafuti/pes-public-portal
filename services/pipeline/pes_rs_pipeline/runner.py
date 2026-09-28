"""Run orchestration skeleton — spec §4 workflow and §5 autonomous operation.

The scheduled entrypoint (Cloud Scheduler, 20-minute cadence). Each step is a
named seam that P1 fills in; the run lock, time budget, retries and the health
row are structural and modelled here from the start.
"""

import logging
from datetime import UTC, datetime

from .config import PipelineConfig

log = logging.getLogger(__name__)


def run_once(config: PipelineConfig) -> dict:
    """One scheduled run. Returns the health-row payload (spec §6.5)."""
    started = datetime.now(UTC)
    # P1 wiring, in spec §4 order:
    # 1. acquire run lock (pes_rs_lock, TTL config.lock_ttl_minutes)
    # 2. authenticate to the PES Open API (Keycloak client credentials)
    # 3. fetch applications + monitoring visits (paged, de-duplicated)
    # 4. select new/changed/ready/retry objects (incremental, geom_input_hash)
    # 5. resolve + validate parcels (geometry.resolve_geom_source, area guards)
    # 6. compute indicators in GEE per windows.baseline_window/current_window,
    #    isolating indicator failures into partial rows
    # 7. write results/exceptions/queue/parcel-cache, respecting the
    #    config.max_run_minutes time budget
    # 8. release lock, write one pes_rs_runs health row
    log.info("run_once: skeleton run (no steps wired yet)")
    return {
        "start_utc": started.isoformat(),
        "end_utc": datetime.now(UTC).isoformat(),
        "selected": 0,
        "ok": 0,
        "partial": 0,
        "skipped": 0,
        "queued": 0,
        "stopped_reason": "skeleton",
    }


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    print(run_once(PipelineConfig()))


if __name__ == "__main__":
    main()
