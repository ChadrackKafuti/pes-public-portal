from datetime import date

from pes_rs_pipeline.geometry import buffer_radius_m, geom_input_hash, resolve_geom_source
from pes_rs_pipeline.models import GeomSource, ObjectType, PesObject
from pes_rs_pipeline.windows import baseline_window, baseline_years_effective, current_window


def _obj(**kw) -> PesObject:
    base = dict(
        object_id="A1",
        object_type=ObjectType.APPLICATION,
        object_date=date(2024, 6, 1),
        application_date=date(2024, 6, 1),
        application_id="A1",
    )
    base.update(kw)
    return PesObject(**base)


def test_baseline_is_five_years_before_application_date():
    w = baseline_window(date(2024, 6, 1), "dynamic_world")
    assert w.start == date(2019, 6, 2)  # -5 years + 1 day
    assert w.end == date(2024, 6, 1)
    assert baseline_years_effective(w) == 5


def test_baseline_clamps_to_dataset_floor():
    # Application in 2019: a 5-year Dynamic World baseline would start in 2014,
    # before the dataset floor (2016-01-01) — spec §2.2 temporal note.
    w = baseline_window(date(2019, 6, 1), "dynamic_world")
    assert w.start == date(2016, 1, 1)
    assert baseline_years_effective(w) == 3


def test_viirs_floor_is_much_later():
    w = baseline_window(date(2024, 6, 1), "viirs")
    assert w.start == date(2023, 9, 1)
    assert baseline_years_effective(w) == 1  # max(1, …)


def test_current_window_blank_for_applications():
    assert current_window(_obj()) is None


def test_current_window_runs_from_application_to_visit():
    visit = _obj(
        object_id="M1",
        object_type=ObjectType.MONITORING_VISIT,
        object_date=date(2025, 3, 15),
        application_date=date(2024, 6, 1),
    )
    w = current_window(visit, today=date(2026, 1, 1))
    assert w is not None
    assert (w.start, w.end) == (date(2024, 6, 1), date(2025, 3, 15))


def test_future_visit_end_clamped_to_today():
    visit = _obj(
        object_id="M2",
        object_type=ObjectType.MONITORING_VISIT,
        object_date=date(2027, 1, 1),
        application_date=date(2024, 6, 1),
    )
    w = current_window(visit, today=date(2026, 9, 28))
    assert w is not None and w.end == date(2026, 9, 28)


def test_buffer_radius_round_trips_area():
    import math

    r = buffer_radius_m(1.0)  # 1 ha
    assert abs(math.pi * r * r - 10_000) < 1e-6


def test_geometry_priority_and_hash():
    app = _obj(shape_wkt="POLYGON((0 0,1 0,1 1,0 0))", point=(15.0, -1.0), estimated_area_ha=2.0)
    src, bearer = resolve_geom_source(app)
    assert src is GeomSource.POLYGON and bearer is app

    visit = _obj(object_id="M3", object_type=ObjectType.MONITORING_VISIT)
    src, bearer = resolve_geom_source(visit, parent=app)
    assert src is GeomSource.POLYGON_INHERITED and bearer is app

    assert resolve_geom_source(_obj()) is None  # no usable geometry

    # EstimatedArea must not affect the hash (spec §3).
    h1 = geom_input_hash(None, (15.0, -1.0))
    h2 = geom_input_hash(None, (15.0, -1.0))
    h3 = geom_input_hash(None, (15.1, -1.0))
    assert h1 == h2 and h1 != h3
