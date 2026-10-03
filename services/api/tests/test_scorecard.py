"""Activity scorecard logic (M24) — pure-function unit tests."""

from app.profile import _activity_group
from app.scorecard import ScoreInputs, build_scorecard, overall_status


def _by_key(entries):
    return {e["key"]: e for e in entries}


def test_activity_groups_cover_the_spectrum():
    assert _activity_group("Agroforestry") == "agroforestry"
    assert _activity_group("Reforestation / plantation") == "reforestation"
    assert _activity_group("Assisted natural regeneration") == "natural_regeneration"
    assert _activity_group("Forest conservation") == "conservation"
    assert _activity_group("Sustainable forest management") == "forest_management"
    assert _activity_group("Gestion durable des forêts") == "forest_management"
    assert _activity_group("Deforestation-free agriculture") == "deforestation_free_agriculture"
    assert _activity_group(None) == "generic"


def test_reforestation_achievement_thresholds():
    x = ScoreInputs(contracted_area_ha=10, tc_latest=8, tc_prev=7)
    e = _by_key(build_scorecard("reforestation", x))
    assert e["achieved_pct"]["value"] == 80.0 and e["achieved_pct"]["status"] == "ok"
    assert e["tc_trend"]["status"] == "ok"

    low = ScoreInputs(contracted_area_ha=10, tc_latest=2, tc_prev=4)
    e = _by_key(build_scorecard("reforestation", low))
    assert e["achieved_pct"]["status"] == "action"
    # 2 ha lost on a 10 ha contract (>10 %) is an action, not a watch
    assert e["tc_trend"]["status"] == "action"


def test_fire_exclusion_against_baseline():
    quiet = ScoreInputs(burned_current_ha=0.0, burned_5yr_ha=5.0)
    e = _by_key(build_scorecard("natural_regeneration", quiet))
    assert e["fire_exclusion"]["status"] == "ok"
    worse = ScoreInputs(burned_current_ha=2.0, burned_5yr_ha=5.0)
    assert _by_key(build_scorecard("natural_regeneration", worse))["fire_exclusion"]["status"] == "action"
    better = ScoreInputs(burned_current_ha=0.5, burned_5yr_ha=5.0)
    assert _by_key(build_scorecard("natural_regeneration", better))["fire_exclusion"]["status"] == "watch"


def test_sfm_disturbance_benchmark():
    ok = ScoreInputs(parcel_area_ha=100, defor_current_ha=2)
    assert _by_key(build_scorecard("forest_management", ok))["disturbance_pct"]["status"] == "ok"
    over = ScoreInputs(parcel_area_ha=100, defor_current_ha=12)
    e = _by_key(build_scorecard("forest_management", over))["disturbance_pct"]
    assert e["status"] == "action" and e["target"] == 9.0


def test_unmeasured_is_none_and_overall_worst_wins():
    entries = build_scorecard("conservation", ScoreInputs())
    assert {e["status"] for e in entries if e["key"] != "open_incidents"} == {"none"}
    # no incidents -> ok; everything else unmeasured -> overall ok
    assert overall_status(entries) == "ok"
    entries = build_scorecard(
        "deforestation_free_agriculture",
        ScoreInputs(defor_current_ha=0.5, open_incidents=0),
    )
    assert overall_status(entries) == "action"
