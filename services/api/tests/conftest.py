"""API test fixtures: a throwaway Postgres cluster with the core schema and
a small seed, mirroring services/pipeline/tests/test_store_integration.py.

Skipped when no Postgres server binaries are available.
"""

import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

import pytest

SCHEMA = Path(__file__).resolve().parents[3] / "infra" / "db" / "init" / "001_core.sql"

SEED = """
INSERT INTO pes_parcels
  (application_id, application_code, contract_code, application_date, shape_raw,
   point_lon, point_lat, estimated_area_ha, pes_activity, geom_input_hash)
VALUES
  ('A1', 'APP-001', 'CTR-001', '2024-06-01', 'POLYGON((15 -1,15.01 -1,15.01 -0.99,15 -1))',
   NULL, NULL, 3.5, 'Agroforestry', 'h1'),
  ('A2', 'APP-002', NULL, '2024-07-01', NULL, 15.5, -2.25, 2.0, 'Reforestation', 'h2'),
  ('A4', 'APP-004', NULL, '2024-08-01', NULL, NULL, NULL, 1.0, 'Regeneration', 'h4');

INSERT INTO pes_rs_objects
  (object_id, object_type, object_date, application_id, application_code,
   contract_code, pes_activity, parcel_area_ha,
   tree_cover_ha, defor_5yr_ha_yr, geom_source, baseline_years, status,
   failed_indicators, geom_input_hash)
VALUES
  ('A1', 'application', '2024-06-01', 'A1', 'APP-001', 'CTR-001', 'Agroforestry', 3.4,
   2.1, 0.05, 'polygon', 5, 'ok', '{}', 'h1'),
  ('M1', 'monitoring_visit', '2025-03-15', 'A1', 'APP-001', 'CTR-001', 'Agroforestry', 3.4,
   2.0, 0.05, 'polygon_inherited', 5, 'partial', '{fire_alerts}', 'h1');

INSERT INTO pes_rs_runs
  (start_utc, end_utc, duration_s, fetched_app, fetched_mon, selected, ok, partial,
   skipped, queued, stopped_reason)
VALUES (now() - interval '20 minutes', now() - interval '19 minutes', 60, 2, 1, 3,
        1, 1, 1, 0, 'completed');
"""


def _pg_bin() -> str | None:
    for base in ("/usr/lib/postgresql/16/bin", "/usr/lib/postgresql/15/bin"):
        if (Path(base) / "initdb").exists():
            return base
    found = shutil.which("initdb")
    return str(Path(found).parent) if found else None


def _as_unprivileged(cmd: list[str]) -> list[str]:
    if os.geteuid() != 0:
        return cmd
    return ["setpriv", "--reuid=nobody", "--regid=nogroup", "--clear-groups", *cmd]


@pytest.fixture(scope="session")
def client():
    bin_dir = _pg_bin()
    if bin_dir is None:
        pytest.skip("no Postgres server binaries")
    base = Path(tempfile.mkdtemp(prefix="cafi-apitest-"))
    data, sockets = base / "data", base / "sock"
    data.mkdir()
    sockets.mkdir()
    if os.geteuid() == 0:
        base.chmod(0o755)
        for d in (data, sockets):
            shutil.chown(d, "nobody", "nogroup")
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
                    conn.execute(SEED)
                    conn.commit()
                break
            except psycopg.OperationalError:
                time.sleep(0.2)
        else:
            pytest.fail("postgres did not come up")

        os.environ["CAFI_DATABASE_URL"] = url
        from app import db

        db._pool = None  # rebuild the pool against the test database
        from fastapi.testclient import TestClient

        from app.main import app

        with TestClient(app) as tc:
            yield tc
        if db._pool is not None:
            db._pool.close()
            db._pool = None
    finally:
        proc.terminate()
        proc.wait(timeout=10)
        shutil.rmtree(base, ignore_errors=True)
