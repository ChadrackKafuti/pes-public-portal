"""Enrichment, situation classification, parent linking, fallback dedup."""

from collections import Counter, defaultdict

from cb_governance.enrich import (
    Geom,
    SpatialLookup,
    attach_parents,
    classify_situation,
    dedup_fallbacks,
    enrich,
)

BIG = {"rings": [[[15.0, -1.0], [15.0, -1.1], [15.1, -1.1], [15.1, -1.0], [15.0, -1.0]]]}
SMALL = {"rings": [[[15.04, -1.04], [15.04, -1.06], [15.06, -1.06], [15.06, -1.04], [15.04, -1.04]]]}


def test_geom_area_and_label_point():
    area = Geom.area_ha(BIG)
    assert 11000 < area < 13500  # ~0.1 deg square near the equator ≈ 12,300 ha
    x, y = Geom.label_point(BIG)
    assert 15.0 < x < 15.1 and -1.1 < y < -1.0


def _lookup():
    lk = SpatialLookup()
    country = [[[14.0, -2.0], [14.0, 0.0], [16.0, 0.0], [16.0, -2.0], [14.0, -2.0]]]
    lk.admin0 = [((14.0, -2.0, 16.0, 0.0), country, "Republic of Congo", "COG")]
    lk.admin1 = [((14.0, -2.0, 16.0, 0.0), country, "Sangha", "COG")]
    lk.ok = True
    return lk


def test_enrich_sets_area_country_check_and_province():
    rec = {"iso3": "COG", "src_uid": "COG:conc:1", "name": "X", "sub_type_std": "concession",
           "status_std": "attributed", "province": None}
    stats = Counter()
    enrich("concessions", rec, BIG, _lookup(), stats)
    assert rec["country_check"] == "ok"
    assert rec["province"] == "Sangha"
    assert stats["province_computed"] == 1
    assert rec["situation"] == "complete"


def test_enrich_flags_country_mismatch():
    rec = {"iso3": "GAB", "src_uid": "GAB:conc:1", "name": "X", "province": None}
    stats = Counter()
    enrich("concessions", rec, BIG, _lookup(), stats)
    assert rec["country_check"] == "mismatch"
    assert stats["country_mismatch"] == 1


def test_classify_situation_zoning():
    assert classify_situation("concession_zoning",
                              {"zone_type_std": "production", "parent_uid": "X:1",
                               "area_calc_ha": 5}) == "complete"
    assert classify_situation("concession_zoning",
                              {"zone_type_std": "unclassified", "zone_name": "S1"}) == "part_complete"
    assert classify_situation("concession_zoning", {"zone_type_std": "unclassified"}) == "no_data"


def test_attach_parents_by_reference_then_spatial():
    parents = [
        {"src_uid": "COG:conc:1", "iso3": "COG", "name": "Ngombe", "reference": "UFA-NGOMBE",
         "area_calc_ha": 100.0},
        {"src_uid": "COG:conc:2", "iso3": "COG", "name": "Pokola", "reference": "UFA-POKOLA",
         "area_calc_ha": 100.0},
    ]
    children = [
        {"src_uid": "COG:series:1", "iso3": "COG", "parent_ref": "ufa ngombe", "zone_name": "S1"},
        {"src_uid": "COG:series:2", "iso3": "COG", "parent_ref": None, "zone_name": "S2",
         "centroid_x": 15.05, "centroid_y": -1.05},
    ]
    rule = {"child_field": "parent_ref", "parent_field": "name", "alt_parent_field": "reference"}
    stats = defaultdict(int)
    unmatched = []
    geoms = {"COG:conc:1": SMALL, "COG:conc:2": None}
    attach_parents(children, parents, rule, stats, unmatched, geoms)
    assert children[0]["parent_uid"] == "COG:conc:1"       # name match
    assert children[1]["parent_uid"] == "COG:conc:1"       # spatial containment
    assert stats["parent_matched"] == 2
    assert stats["parent_spatial"] == 1
    assert not unmatched


def test_dedup_fallbacks_reparents_and_drops():
    primary_spec = {"role": "primary"}
    fallback_spec = {"role": "fallback"}
    items = [
        ({"src_uid": "COD:geocfcl:1", "iso3": "COD", "name": "CFCL Bombole", "admin2": None,
          "reference": None, "community": None, "link_key": "CFCL BOMBOLE"}, BIG, primary_spec),
        ({"src_uid": "COD:wri_cf:9", "iso3": "COD", "name": "CFCL Bombole", "admin2": None,
          "reference": None, "community": None, "link_key": "CFCL BOMBOLE"}, BIG, fallback_spec),
    ]
    stats = defaultdict(Counter)
    alias = {}
    keep, dropped = dedup_fallbacks("community_forests", items, [primary_spec, fallback_spec], stats, alias)
    assert len(keep) == 1 and len(dropped) == 1
    assert alias == {"COD:wri_cf:9": "COD:geocfcl:1"}
    assert dropped[0][0]["dedup_of"] == "COD:geocfcl:1"
