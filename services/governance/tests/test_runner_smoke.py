"""Offline end-to-end run: stubbed sources -> harmonise -> enrich -> link ->
Postgres, twice, to exercise upsert + retire + state checkpointing."""

import cb_governance.runner as runner
from cb_governance.enrich import SpatialLookup
from cb_governance.fetchers import SrcFeature
from cb_governance.store import GovStore

CONC = {"rings": [[[15.0, -1.0], [15.0, -1.1], [15.1, -1.1], [15.1, -1.0], [15.0, -1.0]]]}
SERIE = {"rings": [[[15.02, -1.02], [15.02, -1.05], [15.05, -1.05], [15.05, -1.02], [15.02, -1.02]]]}

CONC_SPEC = dict(iso3="COG", layer_key="conc", kind="agol", url="https://x/0",
                 harmoniser="cog_conc", vintage="2026")
SERIES_SPEC = dict(iso3="COG", layer_key="series", kind="agol", url="https://x/1",
                   harmoniser="cog_series", vintage="2024",
                   parent=dict(layer="concessions", layer_key="conc", child_field="parent_ref",
                               parent_field="name", alt_parent_field="reference"))

SMALL_SOURCES = {"concessions": [CONC_SPEC], "concession_zoning": [SERIES_SPEC]}


def _fake_fetch(include_conc_2=True):
    def fetch(layer, spec):
        feats = []
        if layer == "concessions":
            feats.append(SrcFeature(layer, "COG", "conc", 1, "g-1",
                                    {"nom_ufa": "Ngombe", "attributaire": "IFO"},
                                    CONC, spec["url"], None))
            if include_conc_2:
                feats.append(SrcFeature(layer, "COG", "conc", 2, "g-2",
                                        {"nom_ufa": "Pokola"}, CONC, spec["url"], None))
        else:
            feats.append(SrcFeature(layer, "COG", "series", 10, "g-10",
                                    {"nom_ufa": "Ngombe", "affectation": "Serie de production"},
                                    SERIE, spec["url"], None))
        return spec, feats, {"name": layer, "fields": []}, None
    return fetch


def test_run_end_to_end(dsn, monkeypatch):
    store = GovStore(dsn)
    with store.connection() as conn:
        conn.execute("DELETE FROM gov_areas"); conn.execute("DELETE FROM gov_ingest_state")
        conn.commit()
    monkeypatch.setattr(runner, "SOURCES", SMALL_SOURCES)
    monkeypatch.setattr(runner, "LAYERS", None)
    monkeypatch.setattr(runner, "COUNTRIES", None)
    monkeypatch.setattr(runner, "source_needs_refresh",
                        lambda layer, spec, state: spec.update(_refresh_reason="test", _fingerprint="t") or True)
    monkeypatch.setattr(runner.SpatialLookup, "load", lambda self: self)  # offline: lookup disabled
    monkeypatch.setattr(runner, "fetch_source", _fake_fetch())

    stats = runner.run(store)
    assert stats is not None
    with store.connection() as conn:
        n = conn.execute("SELECT count(*) FROM gov_areas WHERE retired = 0").fetchone()[0]
        assert n == 3
        parent = conn.execute(
            "SELECT parent_uid FROM gov_areas WHERE layer = 'concession_zoning'"
        ).fetchone()[0]
        assert parent == "COG:conc:g-1"           # linked by name within the run
        runs = conn.execute("SELECT loaded, failed FROM gov_runs ORDER BY run_id DESC").fetchone()
        assert runs[0] == 3 and runs[1] == 0

    # second run without Pokola: it must be retired, the rest updated in place
    monkeypatch.setattr(runner, "fetch_source", _fake_fetch(include_conc_2=False))
    runner.run(store)
    with store.connection() as conn:
        retired = conn.execute(
            "SELECT src_uid FROM gov_areas WHERE retired = 1"
        ).fetchall()
        assert [r[0] for r in retired] == ["COG:conc:g-2"]
        assert conn.execute("SELECT count(*) FROM gov_areas").fetchone()[0] == 3
