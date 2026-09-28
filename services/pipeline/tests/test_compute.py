from datetime import date

from pes_rs_pipeline.compute import compute_indicators
from pes_rs_pipeline.config import PipelineConfig
from pes_rs_pipeline.models import GeomSource, ObjectType, PesObject, Status
from pes_rs_pipeline.runner import RunResult, normalize_all, process_objects
from pes_rs_pipeline.windows import Interval

TODAY = date(2026, 9, 28)


class FakeBackend:
    """Deterministic IndicatorBackend: values encode the interval length."""

    def __init__(self, *, area_ha: float = 100.0, fail: set[str] | None = None):
        self._area = area_ha
        self._fail = fail or set()

    def _maybe_fail(self, name: str):
        if name in self._fail:
            raise RuntimeError(f"{name} boom")

    def resolve_parcel(self, bearer, source):
        return {"bearer": bearer.object_id, "source": source}

    def parcel_area_ha(self, parcel):
        return self._area

    def tree_cover(self, parcel, at):
        self._maybe_fail("tree_cover")
        return 42.0, 7, 0.95

    def tree_cover_loss(self, parcel, interval: Interval):
        self._maybe_fail("loss")
        return interval.years  # 1 ha per year: defor_5yr_ha_yr == 1.0 exactly

    def radd_alerts(self, parcel, interval):
        return round(interval.years * 10)

    def fire_alerts(self, parcel, interval):
        return 3

    def burned_area_ha(self, parcel, interval):
        return 0.0


def _application(**kw) -> PesObject:
    base = dict(
        object_id="A1",
        object_type=ObjectType.APPLICATION,
        object_date=date(2024, 6, 1),
        application_date=date(2024, 6, 1),
        application_id="A1",
        pes_activity="Agroforestry",
        shape_wkt="POLYGON((0 0,1 0,1 1,0 0))",
    )
    base.update(kw)
    return PesObject(**base)


def _visit(**kw) -> PesObject:
    base = dict(
        object_id="M1",
        object_type=ObjectType.MONITORING_VISIT,
        object_date=date(2025, 3, 15),
        application_date=date(2024, 6, 1),
        application_id="A1",
    )
    base.update(kw)
    return PesObject(**base)


def test_application_row_has_blank_current_fields():
    row = compute_indicators(
        _application(), _application(), GeomSource.POLYGON, FakeBackend(),
        PipelineConfig(), today=TODAY,
    )
    assert row.status is Status.OK
    assert row.tree_cover_ha == 42.0
    assert row.defor_5yr_ha_yr == 1.0
    assert row.baseline_years == 5
    # Spec §1/§7: current-period indicators are blank for applications.
    assert row.defor_current_ha is None
    assert row.defor_alerts_current is None
    assert row.fire_alerts_current is None
    assert row.burned_area_current_ha is None
    assert row.current_start is None


def test_visit_row_fills_current_period():
    app = _application()
    row = compute_indicators(
        _visit(), app, GeomSource.POLYGON_INHERITED, FakeBackend(),
        PipelineConfig(), today=TODAY,
    )
    assert row.current_start == date(2024, 6, 1)
    assert row.defor_current_ha == 1.0  # max(1, …) years over 9.5 months
    assert row.defor_alerts_current == 10
    assert row.geom_source is GeomSource.POLYGON_INHERITED


def test_indicator_failure_isolates_to_partial():
    row = compute_indicators(
        _application(), _application(), GeomSource.POLYGON,
        FakeBackend(fail={"tree_cover"}), PipelineConfig(), today=TODAY,
    )
    assert row.status is Status.PARTIAL
    assert row.failed_indicators == ["tree_cover"]
    assert row.tree_cover_ha is None  # blank, not zero (spec §7)
    assert row.defor_5yr_ha_yr == 1.0  # other indicators unaffected


def test_process_objects_end_to_end():
    apps = [
        {"id": "A1", "applicationDate": "2024-06-01", "shape": "POLYGON((0 0,1 0,1 1,0 0))"},
        {"id": "A2", "applicationDate": "2024-07-01"},  # no geometry
        {"id": "A3", "applicationDate": "2024-08-01", "point": {"x": 15, "y": -1},
         "estimatedArea": 9999},  # oversize
    ]
    visits = [
        {"id": "M1", "visitDate": "2025-03-15", "applicationId": "A1"},  # inherits A1
        {"id": "M2", "visitDate": "2027-01-01", "applicationId": "A1"},  # future -> deferred
        {"id": "M3", "visitDate": "2025-01-01", "applicationId": "missing"},
    ]
    objects, bad = normalize_all(apps, visits)
    assert bad == [("M3", "parent_failed")]

    from datetime import UTC, datetime

    result = RunResult(start_utc=datetime.now(UTC))
    result.exceptions.extend(bad)
    process_objects(objects, FakeBackend(), PipelineConfig(), result, today=TODAY)

    assert sorted(r.object_id for r in result.rows) == ["A1", "M1"]
    assert result.deferred == ["M2"]
    reasons = dict(result.exceptions)
    assert reasons["A2"] == "no_usable_geometry"
    assert reasons["A3"] == "oversize_gt_5000ha"

    health = result.health_row()
    assert health["ok"] == 2 and health["skipped"] == 3 and health["queued"] == 1


def test_geodesic_oversize_caught_after_compute():
    from datetime import UTC, datetime

    result = RunResult(start_utc=datetime.now(UTC))
    process_objects(
        [_application()], FakeBackend(area_ha=6000), PipelineConfig(), result, today=TODAY
    )
    assert result.rows == []
    assert result.exceptions == [("A1", "oversize_gt_5000ha")]


def test_time_budget_stops_processing():
    from datetime import UTC, datetime, timedelta

    result = RunResult(start_utc=datetime.now(UTC))
    process_objects(
        [_application()], FakeBackend(), PipelineConfig(), result,
        today=TODAY, deadline=datetime.now(UTC) - timedelta(seconds=1),
    )
    assert result.rows == []
    assert result.stopped_reason == "time_budget"  # spec §5: next run continues
