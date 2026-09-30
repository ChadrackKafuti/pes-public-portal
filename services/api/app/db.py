"""Connection pooling for the platform database."""

import os
from collections.abc import Iterator

from psycopg_pool import ConnectionPool

from .settings import settings

_pool: ConnectionPool | None = None


def get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        # Env wins over the imported settings so tests (and container
        # entrypoints) can point the API at a database after import time.
        url = os.getenv("CAFI_DATABASE_URL", settings.database_url)
        # prepare_threshold=None: the production database sits behind Supabase's
        # transaction pooler, where auto-prepared statements vanish between
        # transactions ("prepared statement ... does not exist").
        _pool = ConnectionPool(
            url,
            min_size=1,
            max_size=10,
            open=True,
            kwargs={"prepare_threshold": None},
        )
    return _pool


def get_conn() -> Iterator:
    """FastAPI dependency: one pooled connection per request."""
    with get_pool().connection() as conn:
        yield conn
