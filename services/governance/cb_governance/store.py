"""Postgres writer — replaces the notebook's hosted-service Publisher (§6).

Same upsert-by-src_uid / retire-by-scope semantics as Publisher.write, but
into the platform's own tables (infra/db/init/003_governance.sql). Geometry
is stored as GeoJSON (WGS84, 5-decimal precision) so the API can serve
FeatureCollections without PostGIS.
"""

import json
from contextlib import contextmanager
from datetime import UTC, datetime

from .fetchers import _signed_area
from .helpers import ms_to_datetime
from .schema import FIELDS_COMMON, FIELDS_DOCS, FIELDS_EXTRA

RUN_LOCK_KEY = 0x_CAF1_60  # governance ingest advisory lock (distinct from the RS pipeline's)

BATCH_SIZE = 500  # rows per executemany chunk (psycopg pipelines each chunk)


def _chunks(rows: list, size: int = BATCH_SIZE):
    for i in range(0, len(rows), size):
        yield rows[i : i + size]

_COMMON_NAMES = [f["name"] for f in FIELDS_COMMON]
_COMMON_DATES = {f["name"] for f in FIELDS_COMMON if f["type"] == "esriFieldTypeDate"}
_DOC_NAMES = [f["name"] for f in FIELDS_DOCS]
_DOC_DATES = {f["name"] for f in FIELDS_DOCS if f["type"] == "esriFieldTypeDate"}
_EXTRA_NAMES = {layer: [f["name"] for f in fields] for layer, fields in FIELDS_EXTRA.items()}
_EXTRA_DATES = {
    layer: {f["name"] for f in fields if f["type"] == "esriFieldTypeDate"}
    for layer, fields in FIELDS_EXTRA.items()
}


def _ms_to_dt(ms):
    dt = ms_to_datetime(ms)
    return dt.replace(tzinfo=UTC) if dt is not None else None


def _point_in_ring(x, y, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-300) + xi:
            inside = not inside
        j = i
    return inside


def esri_rings_to_geojson(geom, precision=5):
    """Esri polygon json -> GeoJSON Polygon/MultiPolygon (outer rings are the
    clockwise ones, per the esri convention; holes join the outer ring that
    contains their first vertex)."""
    if not geom or not geom.get("rings"):
        return None
    outers, holes = [], []
    for ring in geom["rings"]:
        r = [[round(float(p[0]), precision), round(float(p[1]), precision)] for p in ring]
        if len(r) < 4:
            continue
        (outers if _signed_area(r) > 0 else holes).append(r)
    if not outers:  # some sources emit counter-clockwise outer rings only
        outers, holes = holes, []
    polys = [[r] for r in outers]
    for h in holes:
        x, y = h[0]
        target = next((p for p in polys if _point_in_ring(x, y, p[0])), None)
        if target is not None:
            target.append(h)
        else:  # orphan hole: keep it as its own polygon rather than dropping area
            polys.append([h])
    if len(polys) == 1:
        return {"type": "Polygon", "coordinates": polys[0]}
    return {"type": "MultiPolygon", "coordinates": polys}


def _extras(layer, rec):
    out = {}
    for name in _EXTRA_NAMES.get(layer, []):
        if name == "parent_uid":  # promoted to a real column
            continue
        v = rec.get(name)
        if v is None:
            continue
        if name in _EXTRA_DATES.get(layer, set()):
            dt = _ms_to_dt(v)
            v = dt.date().isoformat() if dt else None
        out[name] = v
    return out


class GovStore:
    def __init__(self, database_url: str):
        self._url = database_url

    @contextmanager
    def connection(self):
        import psycopg

        # prepare_threshold=None: Supabase's transaction pooler moves each
        # transaction to a fresh server session, where psycopg's auto-prepared
        # statements "do not exist" — so auto-preparation stays off.
        with psycopg.connect(self._url, prepare_threshold=None) as conn:
            yield conn

    # -- run lock ---------------------------------------------------------

    def try_acquire_lock(self, conn) -> bool:
        row = conn.execute("SELECT pg_try_advisory_lock(%s)", (RUN_LOCK_KEY,)).fetchone()
        return bool(row[0])

    def release_lock(self, conn) -> None:
        conn.execute("SELECT pg_advisory_unlock(%s)", (RUN_LOCK_KEY,))

    # -- areas ------------------------------------------------------------

    def write(self, conn, layer, items, scopes=None):
        """items: list of (rec, geom). Upsert by src_uid, then retire the rows
        of successfully refreshed scopes that this run did not touch.
        Returns the notebook's stats dict.

        Rows go up in executemany chunks (psycopg pipelines them, so a remote
        database costs a handful of round-trips instead of one per row); a
        failing chunk falls back to row-by-row under savepoints so one bad
        row is skipped, never the batch. added/updated split comes from a
        pre-query of existing keys — exact, since the advisory run lock makes
        this the only writer."""
        run_start = datetime.now(UTC)
        cols = [c for c in _COMMON_NAMES if c != "loaded_at"]
        sql = (
            "INSERT INTO gov_areas (" + ", ".join(cols)
            + ", parent_uid, extras, geom_geojson, loaded_at) VALUES ("
            + ", ".join(["%s"] * len(cols))
            + ", %s, %s, %s, %s) ON CONFLICT (src_uid) DO UPDATE SET "
            + ", ".join(f"{c} = EXCLUDED.{c}" for c in cols if c != "src_uid")
            + ", parent_uid = EXCLUDED.parent_uid, extras = EXCLUDED.extras"
            + ", geom_geojson = EXCLUDED.geom_geojson, loaded_at = EXCLUDED.loaded_at"
        )

        def params(rec, geom):
            values = []
            for c in cols:
                v = rec.get(c)
                values.append(_ms_to_dt(v) if c in _COMMON_DATES else v)
            gj = esri_rings_to_geojson(geom)
            return (
                *values,
                rec.get("parent_uid"),
                json.dumps(_extras(layer, rec), ensure_ascii=False),
                json.dumps(gj, ensure_ascii=False) if gj else None,
                run_start,
            )

        rows = [(rec["src_uid"], params(rec, geom)) for rec, geom in items]
        stats = self._batched_upsert(
            conn, "gov_areas", "src_uid", sql, rows, what=layer
        )
        with conn.transaction():
            stats["retired"] = self._retire(conn, "gov_areas", "src_uid", layer, scopes, run_start)
        return stats

    def _batched_upsert(self, conn, table, key, sql, rows, *, what):
        """rows: list of (key_value, params). Returns added/updated/failed."""
        from .config import log

        stats = {"added": 0, "updated": 0, "failed": 0, "retired": 0}
        keys = [k for k, _ in rows]
        existing: set = set()
        with conn.transaction():
            for chunk in _chunks(keys, 5000):
                found = conn.execute(
                    f"SELECT {key} FROM {table} WHERE {key} = ANY(%s)", (chunk,)
                ).fetchall()
                existing.update(r[0] for r in found)
            for chunk in _chunks(rows):
                try:
                    with conn.transaction():
                        conn.cursor().executemany(sql, [p for _, p in chunk])
                    ok_keys = (k for k, _ in chunk)
                except Exception:
                    # One bad row poisons the chunk: replay it row by row so
                    # only the offender is skipped (Publisher.apply's retry).
                    ok = []
                    for k, p in chunk:
                        try:
                            with conn.transaction():
                                conn.execute(sql, p)
                            ok.append(k)
                        except Exception as e:
                            stats["failed"] += 1
                            log(f"  insert failed ({what}): {str(e)[:200]} :: {k}", "WARN")
                    ok_keys = iter(ok)
                for k in ok_keys:
                    stats["updated" if k in existing else "added"] += 1
        return stats

    def _retire(self, conn, table, key, layer, scopes, run_start):
        retired = 0
        layer_cond = "AND layer = %s" if table == "gov_areas" else ""
        for scope in scopes or []:
            params = [run_start, scope + "%"] + ([layer] if layer_cond else [])
            cur = conn.execute(
                f"""
                UPDATE {table} SET retired = 1, loaded_at = %s
                WHERE {key} LIKE %s {layer_cond}
                  AND (retired = 0 OR retired IS NULL) AND loaded_at < %s
                """,
                (*params, run_start),
            )
            retired += cur.rowcount
        return retired

    def load_parent_index(self, conn, layer):
        rows = conn.execute(
            """
            SELECT src_uid, iso3, name, reference, community, link_key,
                   province, layer, src_layer
            FROM gov_areas WHERE layer = %s AND retired = 0
            """,
            (layer,),
        ).fetchall()
        names = ["src_uid", "iso3", "name", "reference", "community", "link_key",
                 "province", "layer", "src_layer"]
        return [dict(zip(names, r, strict=True)) for r in rows] or None

    # -- documents --------------------------------------------------------

    def write_documents(self, conn, rows, scopes=None):
        run_start = datetime.now(UTC)
        cols = [c for c in _DOC_NAMES if c != "loaded_at"]
        sql = (
            "INSERT INTO gov_documents (" + ", ".join(cols) + ", loaded_at) VALUES ("
            + ", ".join(["%s"] * len(cols))
            + ", %s) ON CONFLICT (doc_uid) DO UPDATE SET "
            + ", ".join(f"{c} = EXCLUDED.{c}" for c in cols if c != "doc_uid")
            + ", loaded_at = EXCLUDED.loaded_at"
        )
        batch = [
            (
                rec["doc_uid"],
                (*[_ms_to_dt(rec.get(c)) if c in _DOC_DATES else rec.get(c) for c in cols], run_start),
            )
            for rec in rows
        ]
        stats = self._batched_upsert(
            conn, "gov_documents", "doc_uid", sql, batch, what="documents"
        )
        with conn.transaction():
            stats["retired"] = self._retire(conn, "gov_documents", "doc_uid", None, scopes, run_start)
        return stats

    def update_doc_counts(self, conn, counts: dict) -> None:
        conn.execute(
            """
            UPDATE gov_areas g SET doc_count = d.n
            FROM (SELECT unnest(%s::text[]) AS uid, unnest(%s::int[]) AS n) d
            WHERE g.src_uid = d.uid AND g.doc_count IS DISTINCT FROM d.n
            """,
            (list(counts.keys()), list(counts.values())),
        )
        conn.commit()

    # -- run health -------------------------------------------------------

    def insert_run(self, conn, health: dict) -> None:
        conn.execute(
            """
            INSERT INTO gov_runs
              (start_utc, end_utc, duration_s, update_mode, layers, countries,
               fetched, loaded, retired, failed, docs, fetch_errors, stats)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            (
                health["start_utc"], health["end_utc"], health["duration_s"],
                health["update_mode"], health["layers"], health["countries"],
                health["fetched"], health["loaded"], health["retired"],
                health["failed"], health["docs"],
                json.dumps(health["fetch_errors"], ensure_ascii=False),
                json.dumps(health["stats"], ensure_ascii=False),
            ),
        )
        conn.commit()
