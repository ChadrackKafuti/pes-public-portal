"""Store integration tests against a real, throwaway Postgres cluster.

Skipped automatically when the Postgres server binaries are unavailable
(initdb/pg_ctl). CI installs postgresql, so these run there and locally.
"""

import shutil
import subprocess
import time
from datetime import UTC, date, datetime
from pathlib import Path

import pytest

from pes_rs_pipeline.config import PipelineConfig
from pes_rs_pipeline.geometry import geom_input_hash
from pes_rs_pipeline.models import GeomSource, IndicatorRow, ObjectType, PesObject, Status
from pes_rs_pipeline.store import Store

PG_BIN_CANDIDATES = ["/usr/lib/postgresql/16/bin", "/usr/lib/postgresql/15/bin", ""]
SCHEMA = Path(__file__).resolve().parents[3] / "infra" / "db" / "init" / "001_core.sql"


def _pg_bin() -> str | None:
    for base in PG_BIN_CANDIDATES:
        path = shutil.which("initdb", path=base or None) if base else shutil.which("initdb")
        if base and (Path(base) / "initdb").exists():
            return base
        if not base and path:
            return str(Path(path).parent)
    return None


def _as_unprivileged(cmd: list[str]) -> list[str]:
    """Postgres refuses to run as root; drop to nobody when needed (sandboxes)."""
    import os

    if os.geteuid() != 0:
        return cmd
    return ["setpriv", "--reuid=nobody", "--regid=nogroup", "--clear-groups", *cmd]


@pytest.fixture(scope="session")
def dsn(tmp_path_factory):
    import os
    import tempfile

    bin_dir = _pg_bin()
    if bin_dir is None:
        pytest.skip("no Postgres server binaries")
    # Plain mkdtemp: pytest's tmp root is 0700, which the priv-dropped
    # server user could not traverse when tests run as root.
    base = Path(tempfile.mkdtemp(prefix="cafi-pgtest-"))
    data, sockets = base / "data", base / "sock"
    data.mkdir()
    sockets.mkdir()
    if os.geteuid() == 0:
        import shutil as sh

        base.chmod(0o755)
        for d in (data, sockets):
            sh.chown(d, "nobody", "nogroup")
            d.chmod(0o777)
    subprocess.run(
        _as_unprivileged([f"{bin_dir}/initdb", "-D", str(data), "-U", "cafi", "-A", "trust", "-E", "UTF8", "--locale=C"]),
        check=True, capture_output=True,
    )
    proc = subprocess.Popen(
        _as_unprivileged([
            f"{bin_dir}/postgres", "-D", str(data),
            "-k", str(sockets), "-c", "listen_addresses=",
        ]),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    url = f"postgresql://cafi@/postgres?host={sockets}"
    try:
        import psycopg

        for _ in range(50):
            try:
                with psycopg.connect(url) as conn:
                    conn.execute(SCHEMA.read_text())
                    conn.commit()
                break
            except psycopg.OperationalError:
                time.sleep(0.2)
        else:
            pytest.fail("postgres did not come up")
        yield url
    finally:
        proc.terminate()
        proc.wait(timeout=10)
        shutil.rmtree(base, ignore_errors=True)


@pytest.fixture()
def store(dsn):
    return Store(dsn)


def _row(object_id="A1", status=Status.OK, **kw) -> IndicatorRow:
    base = dict(
        object_id=object_id,
        object_type=ObjectType.APPLICATION,
        object_date=date(2024, 6, 1),
        application_id=object_id,
        application_code=f"APP-{object_id}",
        contract_code=f"CTR-{object_id}",
        pes_activity="Agroforestry",
        parcel_area_ha=12.5,
        geom_source=GeomSource.POLYGON,
        geom_input_hash=geom_input_hash("POLYGON((0 0,1 0,1 1,0 0))", None),
        status=status,
        tree_cover_ha=4.2,
    )
    base.update(kw)
    return IndicatorRow(**base)


def test_schema_applies_and_roundtrip(store):
    with store.connection() as conn:
        store.upsert_rows(conn, [_row()], {}, max_partial_retries=4)
        state = store.load_state(conn, ["A1"])
        assert state["A1"].status is Status.OK
        assert state["A1"].object_date == date(2024, 6, 1)

        # Upsert with new values overwrites in place (same PK).
        store.upsert_rows(conn, [_row(tree_cover_ha=5.0)], state, max_partial_retries=4)
        count = conn.execute("SELECT count(*) FROM pes_rs_objects").fetchone()[0]
        assert count == 1


def test_partial_attempts_escalate_to_partial_final(store):
    with store.connection() as conn:
        prior = {}
        for attempt in range(1, 5):
            row = _row(object_id="P1", status=Status.PARTIAL,
                       failed_indicators=["tree_cover"])
            store.upsert_rows(conn, [row], prior, max_partial_retries=4)
            prior = store.load_state(conn, ["P1"])
            assert prior["P1"].attempts == attempt
        assert prior["P1"].status is Status.PARTIAL_FINAL  # spec §6.1 / §8


def test_queue_lifecycle(store):
    future_visit = PesObject(
        object_id="M9",
        object_type=ObjectType.MONITORING_VISIT,
        object_date=date(2030, 1, 1),
        application_date=date(2024, 6, 1),
        application_id="A1",
    )
    with store.connection() as conn:
        # Deferred future visit enters the queue …
        store.sync_queue(conn, [], [future_visit], today=date(2026, 9, 28))
        status = conn.execute(
            "SELECT status FROM pes_rs_queue WHERE object_id='M9'"
        ).fetchone()[0]
        assert status == "deferred_future"

        # … a partial row queues a retry with a backoff date …
        partial = _row(object_id="M9", status=Status.PARTIAL,
                       object_type=ObjectType.MONITORING_VISIT,
                       failed_indicators=["fire_alerts"])
        store.upsert_rows(conn, [partial], {}, max_partial_retries=4)
        store.sync_queue(conn, [partial], [], today=date(2026, 9, 28))
        next_date = conn.execute(
            "SELECT next_attempt_date FROM pes_rs_queue WHERE object_id='M9'"
        ).fetchone()[0]
        assert next_date == date(2026, 9, 29)

        # … and an ok row leaves the queue.
        ok = _row(object_id="M9", object_type=ObjectType.MONITORING_VISIT)
        store.sync_queue(conn, [ok], [], today=date(2026, 9, 29))
        assert conn.execute(
            "SELECT count(*) FROM pes_rs_queue WHERE object_id='M9'"
        ).fetchone()[0] == 0


def test_parcel_cache_roundtrip(store):
    app = PesObject(
        object_id="A7",
        object_type=ObjectType.APPLICATION,
        object_date=date(2024, 6, 1),
        application_date=date(2024, 6, 1),
        application_id="A7",
        pes_activity="Reforestation",
        point=(15.5, -2.25),
        estimated_area_ha=3.0,
    )
    with store.connection() as conn:
        store.upsert_parcels(conn, [app])
        parents = store.load_parent_parcels(conn, ["A7", "missing"])
    assert list(parents) == ["A7"]
    cached = parents["A7"]
    assert cached.point == (15.5, -2.25)
    assert cached.estimated_area_ha == 3.0
    assert cached.application_date == date(2024, 6, 1)


def test_advisory_lock_excludes_second_runner(store):
    with store.connection() as first, store.connection() as second:
        assert store.try_acquire_lock(first)
        assert not store.try_acquire_lock(second)
        store.release_lock(first)
        assert store.try_acquire_lock(second)
        store.release_lock(second)


def test_exceptions_and_run_row(store):
    with store.connection() as conn:
        store.record_exceptions(conn, [("X1", "no_usable_geometry")])
        start = datetime.now(UTC)
        store.insert_run(conn, {
            "start_utc": start.isoformat(),
            "end_utc": datetime.now(UTC).isoformat(),
            "duration_s": 0.1,
            "fetched_app": 2, "fetched_mon": 1, "selected": 3,
            "ok": 1, "partial": 1, "skipped": 1, "queued": 0,
            "stopped_reason": "completed",
        })
        assert conn.execute("SELECT count(*) FROM pes_rs_runs").fetchone()[0] >= 1
        reason = conn.execute(
            "SELECT reason FROM pes_rs_exceptions WHERE object_id='X1'"
        ).fetchone()[0]
        assert reason == "no_usable_geometry"


def test_annual_candidates_prioritise_contract_linked(store):
    """M22: applications a visit links to a contract outrank the newest
    contract-less backlog, and within each tier series-missing stays first."""
    from pes_rs_pipeline.indicators.annual import _CANDIDATES_SQL

    with store.connection() as conn:
        conn.execute((SCHEMA.parent / "007_annual.sql").read_text())
        for app_id, app_date in (
            ("AC-NEW", date(2025, 9, 1)),   # newest, no contract link
            ("AC-CTR", date(2023, 1, 1)),   # old, contract-linked via visit
            ("AC-DONE", date(2025, 8, 1)),  # newest tier, series already there
        ):
            app = PesObject(
                object_id=app_id, object_type=ObjectType.APPLICATION,
                object_date=app_date, application_date=app_date,
                application_id=app_id,
                shape_wkt="POLYGON((0 0,1 0,1 1,0 0))",
            )
            store.upsert_parcels(conn, [app])
            store.upsert_rows(
                conn, [_row(app_id, object_date=app_date)], {}, max_partial_retries=4
            )
        conn.execute(
            "INSERT INTO pes_annual_indicators (application_id, year, tc_ha) "
            "VALUES ('AC-DONE', 2025, 1.0) ON CONFLICT DO NOTHING"
        )
        rows = conn.execute(
            _CANDIDATES_SQL,
            {"last_year": 2025, "limit": 100, "hidden": [], "priority": ["AC-CTR"]},
        ).fetchall()
        mine = [r[0] for r in rows if str(r[0]).startswith("AC-")]
    assert mine == ["AC-CTR", "AC-NEW", "AC-DONE"]


def test_nrt_incident_lifecycle(store):
    """M23: a detection opens an incident, a repeat extends it, a quiet
    window auto-resolves an OPEN one, and freshly-checked parcels are not
    re-checked until the recheck interval passes."""
    from datetime import UTC, datetime, timedelta

    from pes_rs_pipeline.indicators.nrt import process_nrt

    class StubBackend:
        def __init__(self):
            self.defor = {}
            self.fire = {}
            self.current = None

        def resolve_parcel(self, bearer, source):
            self.current = bearer.application_id
            return bearer.application_id

        def radd_alerts(self, parcel, interval):
            return self.defor.get(parcel, 0)

        def fire_alerts(self, parcel, interval):
            return self.fire.get(parcel, 0)

    config = PipelineConfig(nrt_batch_limit=50, nrt_recheck_hours=12)
    backend = StubBackend()
    backend.defor["NRT-1"] = 7
    today = date(2026, 10, 3)
    deadline = datetime.now(UTC) + timedelta(minutes=5)

    with store.connection() as conn:
        conn.execute((SCHEMA.parent / "008_incidents.sql").read_text())
        app = PesObject(
            object_id="NRT-1", object_type=ObjectType.APPLICATION,
            object_date=date(2025, 6, 1), application_date=date(2025, 6, 1),
            application_id="NRT-1",
            shape_wkt="POLYGON((0 0,1 0,1 1,0 0))",
        )
        store.upsert_parcels(conn, [app])
        conn.commit()

        stats = process_nrt(conn, backend, config, deadline, today)
        assert stats["nrt_opened"] >= 1 and stats["nrt_failed"] == 0
        uid, status = conn.execute(
            "SELECT incident_uid, status FROM pes_incidents "
            "WHERE application_id='NRT-1' AND kind='deforestation'"
        ).fetchone()
        assert status == "open"

        # Freshly checked: nothing is stale, so the next pass does no work.
        assert process_nrt(conn, backend, config, deadline, today)["nrt_checked"] == 0

        # Make it stale with the signal persisting -> same incident extends.
        conn.execute("UPDATE pes_nrt_state SET checked_utc = now() - interval '2 days'")
        conn.commit()
        stats = process_nrt(conn, backend, config, deadline, today)
        assert stats["nrt_extended"] == 1 and stats["nrt_opened"] == 0

        # Signal gone and the last detection predates the window -> resolved.
        backend.defor["NRT-1"] = 0
        conn.execute("UPDATE pes_nrt_state SET checked_utc = now() - interval '2 days'")
        conn.execute(
            "UPDATE pes_incidents SET last_detected = %s WHERE incident_uid = %s",
            (today - timedelta(days=60), uid),
        )
        conn.commit()
        stats = process_nrt(conn, backend, config, deadline, today)
        assert stats["nrt_resolved"] == 1
        assert conn.execute(
            "SELECT status FROM pes_incidents WHERE incident_uid = %s", (uid,)
        ).fetchone()[0] == "resolved"
