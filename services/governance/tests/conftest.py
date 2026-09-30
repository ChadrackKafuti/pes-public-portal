"""Throwaway-Postgres fixture (same mechanics as services/pipeline)."""

import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

import pytest

_INIT = Path(__file__).resolve().parents[3] / "infra" / "db" / "init"
SCHEMA = _INIT / "003_governance.sql"
PG_BIN_CANDIDATES = ["/usr/lib/postgresql/16/bin", "/usr/lib/postgresql/15/bin", ""]


def _pg_bin() -> str | None:
    for base in PG_BIN_CANDIDATES:
        if base and (Path(base) / "initdb").exists():
            return base
        if not base:
            path = shutil.which("initdb")
            if path:
                return str(Path(path).parent)
    return None


def _as_unprivileged(cmd: list[str]) -> list[str]:
    """Postgres refuses to run as root; drop to nobody when needed (sandboxes)."""
    if os.geteuid() != 0:
        return cmd
    return ["setpriv", "--reuid=nobody", "--regid=nogroup", "--clear-groups", *cmd]


@pytest.fixture(scope="session")
def dsn():
    bin_dir = _pg_bin()
    if bin_dir is None:
        pytest.skip("no Postgres server binaries")
    # Plain mkdtemp: pytest's tmp root is 0700, which the priv-dropped
    # server user could not traverse when tests run as root.
    base = Path(tempfile.mkdtemp(prefix="cafi-govtest-"))
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
        _as_unprivileged([f"{bin_dir}/postgres", "-D", str(data), "-k", str(sockets), "-c", "listen_addresses="]),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    url = f"postgresql://cafi@/postgres?host={sockets}"
    try:
        import psycopg

        for _ in range(50):
            try:
                with psycopg.connect(url) as conn:
                    conn.execute(SCHEMA.read_text())
                    conn.execute((_INIT / "004_display_geom.sql").read_text())
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
