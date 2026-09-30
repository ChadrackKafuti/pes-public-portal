"""Store + state integration against a real, throwaway Postgres."""

import time

import pytest

from cb_governance.state import _spec_state_key, mark_sources_success, load_state
from cb_governance.store import GovStore

RINGS = {"rings": [[[15.0, -1.0], [15.0, -1.1], [15.1, -1.1], [15.1, -1.0], [15.0, -1.0]]]}


@pytest.fixture()
def store(dsn):
    return GovStore(dsn)


def _rec(uid="COG:conc:1", **kw):
    rec = {
        "src_uid": uid, "layer": "concessions", "country": "Republic of Congo", "iso3": "COG",
        "name": "Ngombe", "reference": "UFA-NGOMBE", "sub_type_std": "ufa",
        "status_std": "attributed", "situation": "complete", "retired": 0,
        "area_calc_ha": 12000.0, "date_attr": 1267660800000,  # epoch ms -> timestamptz
        "parent_ref": "X",  # extras field (concessions)
        "doc_count": 0,
    }
    rec.update(kw)
    return rec


def test_write_upsert_retire_roundtrip(store):
    with store.connection() as conn:
        conn.execute("DELETE FROM gov_areas")  # isolate from other tests on the shared cluster
        conn.commit()
        res = store.write(conn, "concessions", [(_rec(), RINGS)], scopes=["COG:conc:"])
        assert res["added"] == 1 and res["failed"] == 0

        row = conn.execute(
            "SELECT name, extras, geom_geojson, date_attr FROM gov_areas WHERE src_uid = 'COG:conc:1'"
        ).fetchone()
        assert row[0] == "Ngombe"
        assert row[1]["parent_ref"] == "X"          # extras jsonb
        assert row[2]["type"] in ("Polygon", "MultiPolygon")
        assert row[3].year == 2010                  # ms converted to timestamptz

        # second run: update-in-place, no growth
        res = store.write(conn, "concessions", [(_rec(name="Ngombé"), RINGS)], scopes=["COG:conc:"])
        assert res["updated"] == 1 and res["added"] == 0
        assert conn.execute("SELECT count(*) FROM gov_areas").fetchone()[0] == 1

        # third run without the row: scope retire kicks in
        res = store.write(conn, "concessions", [(_rec(uid="COG:conc:2"), RINGS)], scopes=["COG:conc:"])
        assert res["retired"] == 1
        retired = conn.execute(
            "SELECT retired FROM gov_areas WHERE src_uid = 'COG:conc:1'"
        ).fetchone()[0]
        assert retired == 1


def test_parent_index_reads_live_rows(store):
    with store.connection() as conn:
        conn.execute("DELETE FROM gov_areas")
        conn.commit()
        store.write(conn, "concessions", [(_rec(), RINGS)], scopes=[])
        parents = store.load_parent_index(conn, "concessions")
        assert parents and parents[0]["src_uid"] == "COG:conc:1"
        assert parents[0]["reference"] == "UFA-NGOMBE"


def test_documents_and_doc_counts(store):
    doc = {
        "doc_uid": "COG:conc:1:doc:42", "parent_uid": "COG:conc:1", "parent_layer": "concessions",
        "country": "Republic of Congo", "iso3": "COG", "title": "Plan d'aménagement",
        "category_std": "management_plan", "file_name": "PA.pdf", "url": "https://x/pa.pdf",
        "src_system": "agol_attachment", "retired": 0,
    }
    with store.connection() as conn:
        res = store.write_documents(conn, [doc], scopes=["COG:conc:"])
        assert res["added"] == 1
        store.update_doc_counts(conn, {"COG:conc:1": 1})
        n = conn.execute("SELECT doc_count FROM gov_areas WHERE src_uid = 'COG:conc:1'").fetchone()[0]
        assert n == 1
        # retire: next refresh of the scope without the doc
        res = store.write_documents(conn, [], scopes=["COG:conc:"])
        assert res["retired"] == 1


def test_state_roundtrip_marks_only_successful_sources(store):
    spec_ok = {"iso3": "COG", "layer_key": "conc", "kind": "agol", "_fetch_ok": True,
               "_fingerprint": "abc"}
    spec_bad = {"iso3": "GAB", "layer_key": "permit", "kind": "agol", "_fetch_ok": False}
    with store.connection() as conn:
        mark_sources_success(conn, "concessions", [spec_ok, spec_bad],
                             {"added": 3, "updated": 0, "retired": 1, "failed": 0})
        state = load_state(conn)
        key = _spec_state_key("concessions", spec_ok)
        assert state["sources"][key]["fingerprint"] == "abc"
        assert state["sources"][key]["loaded"] == 3
        assert _spec_state_key("concessions", spec_bad) not in state["sources"]
        assert state["sources"][key]["success_epoch"] == pytest.approx(time.time(), abs=30)

        # a failed load must not checkpoint
        mark_sources_success(conn, "concessions", [spec_ok], {"added": 0, "failed": 2})
        state2 = load_state(conn)
        assert state2["sources"][key]["loaded"] == 3


def test_run_health_row(store):
    from datetime import UTC, datetime

    with store.connection() as conn:
        store.insert_run(conn, {
            "start_utc": datetime.now(UTC), "end_utc": datetime.now(UTC), "duration_s": 1.0,
            "update_mode": "smart", "layers": "concessions", "countries": None,
            "fetched": 10, "loaded": 9, "retired": 0, "failed": 1, "docs": 2,
            "fetch_errors": [], "stats": {"by_scope": {}},
        })
        n = conn.execute("SELECT count(*) FROM gov_runs").fetchone()[0]
        assert n >= 1


def test_batched_write_skips_only_the_bad_row(store):
    with store.connection() as conn:
        conn.execute("DELETE FROM gov_areas")
        conn.commit()
        items = [
            (_rec(uid="COG:conc:10"), RINGS),
            (_rec(uid="COG:conc:11", retired="not-a-number"), RINGS),  # type violation
            (_rec(uid="COG:conc:12"), RINGS),
        ]
        res = store.write(conn, "concessions", items, scopes=[])
        assert res["added"] == 2 and res["failed"] == 1
        kept = [r[0] for r in conn.execute(
            "SELECT src_uid FROM gov_areas ORDER BY src_uid"
        ).fetchall()]
        assert kept == ["COG:conc:10", "COG:conc:12"]
        # a second pass counts them as updates, not adds
        res = store.write(conn, "concessions", [(_rec(uid="COG:conc:10"), RINGS)], scopes=[])
        assert res["updated"] == 1 and res["added"] == 0


def test_display_geometry_written_and_simpler(store):
    from cb_governance.store import display_geometry

    # a dense ring simplifies to fewer vertices
    import math
    ring = [[15 + 0.01 * math.cos(a / 60 * 6.28318), -1 + 0.01 * math.sin(a / 60 * 6.28318)]
            for a in range(61)]
    dense = {"rings": [ring]}
    with store.connection() as conn:
        conn.execute("DELETE FROM gov_areas")
        conn.commit()
        store.write(conn, "concessions", [(_rec(uid="COG:conc:20"), dense)], scopes=[])
        full, disp = conn.execute(
            "SELECT geom_geojson, geom_display FROM gov_areas WHERE src_uid = 'COG:conc:20'"
        ).fetchone()
        assert disp is not None
        n_full = len(full["coordinates"][0])
        n_disp = len(disp["coordinates"][0])
        assert n_disp < n_full
    # a null geometry stays null, an unsimplifiable one falls back unchanged
    assert display_geometry(None) is None
