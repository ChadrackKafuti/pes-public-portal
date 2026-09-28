"""Indicator orchestration — spec §4 step 7 and §11.

`compute_indicators` fills one IndicatorRow for an object: baseline (5yr)
fields for every object, current-period fields for monitoring visits only.
Indicator failures are isolated (spec §4): a failing indicator leaves its
fields None, is listed in failed_indicators, and marks the row `partial`
instead of failing the object.

The satellite work is behind the IndicatorBackend protocol so this module is
testable without Earth Engine; `indicators.gee.GeeBackend` is the real one.
"""

import logging
from datetime import date
from typing import Protocol

from .config import PipelineConfig
from .models import GeomSource, IndicatorRow, ObjectType, PesObject, Status
from .windows import Interval, baseline_window, baseline_years_effective, current_window

log = logging.getLogger(__name__)


class IndicatorBackend(Protocol):
    """One method per satellite computation (spec §11.2–§11.6).

    `parcel` is the backend's own geometry handle, produced by
    `resolve_parcel` from the object's geometry inputs.
    """

    def resolve_parcel(self, bearer: PesObject, source: GeomSource) -> object: ...

    def parcel_area_ha(self, parcel: object) -> float: ...

    def tree_cover(self, parcel: object, at: date) -> tuple[float, int, float]:
        """-> (tree_cover_ha, window_days_used, coverage_frac) — spec §11.2."""
        ...

    def tree_cover_loss(self, parcel: object, interval: Interval) -> float:
        """loss(A, B) in ha — spec §11.3."""
        ...

    def radd_alerts(self, parcel: object, interval: Interval) -> int: ...

    def fire_alerts(self, parcel: object, interval: Interval) -> int: ...

    def burned_area_ha(self, parcel: object, interval: Interval) -> float: ...


def compute_indicators(
    obj: PesObject,
    bearer: PesObject,
    source: GeomSource,
    backend: IndicatorBackend,
    config: PipelineConfig,
    *,
    today: date | None = None,
) -> IndicatorRow:
    """One `pes_rs_objects` row for `obj` (spec §6.1 semantics).

    `bearer` is the geometry-bearing record chosen by
    `geometry.resolve_geom_source` (the object itself, or its parent
    application for inherited parcels).
    """
    from .geometry import geom_input_hash

    parcel = backend.resolve_parcel(bearer, source)
    row = IndicatorRow(
        object_id=obj.object_id,
        object_type=obj.object_type,
        object_date=obj.object_date,
        application_id=obj.application_id,
        application_code=obj.application_code,
        contract_code=obj.contract_code,
        pes_activity=obj.pes_activity,
        parcel_area_ha=backend.parcel_area_ha(parcel),
        geom_source=source,
        # Fingerprint of the object's OWN inputs (spec §3) — selection compares
        # against this on later runs, even when the parcel was inherited.
        geom_input_hash=geom_input_hash(obj.shape_wkt, obj.point),
    )

    app_ref = obj.application_date
    current = current_window(obj, today=today)
    if obj.object_type is ObjectType.MONITORING_VISIT:
        row.current_start = obj.application_date

    def attempt(name: str, fn) -> None:
        try:
            fn()
        except Exception:  # noqa: BLE001 — isolation is the point (spec §4)
            log.exception("indicator %s failed for %s", name, obj.object_id)
            row.failed_indicators.append(name)

    def tree_cover() -> None:
        ha, window_days, coverage = backend.tree_cover(parcel, obj.object_date)
        row.tree_cover_ha = ha
        row.tc_window_days = window_days
        row.tc_coverage = coverage

    def deforestation() -> None:
        w = baseline_window(app_ref, "dynamic_world", years=config.baseline_years, today=today)
        row.defor_5yr_ha_yr = backend.tree_cover_loss(parcel, w) / w.years
        row.baseline_years = baseline_years_effective(w)
        if current is not None:
            row.defor_current_ha = backend.tree_cover_loss(parcel, current)

    def radd() -> None:
        w = baseline_window(app_ref, "radd", years=config.alert_window_years, today=today)
        row.defor_alerts_5yr = backend.radd_alerts(parcel, w)
        if current is not None:
            row.defor_alerts_current = backend.radd_alerts(parcel, current)

    def fire() -> None:
        w = baseline_window(app_ref, "viirs", years=config.alert_window_years, today=today)
        row.fire_alerts_5yr = backend.fire_alerts(parcel, w)
        if current is not None:
            row.fire_alerts_current = backend.fire_alerts(parcel, current)

    def burned() -> None:
        w = baseline_window(
            app_ref, "modis_burned_area", years=config.alert_window_years, today=today
        )
        row.burned_area_5yr_ha = backend.burned_area_ha(parcel, w)
        if current is not None:
            row.burned_area_current_ha = backend.burned_area_ha(parcel, current)

    attempt("tree_cover", tree_cover)
    attempt("deforestation", deforestation)
    attempt("defor_alerts", radd)
    attempt("fire_alerts", fire)
    attempt("burned_area", burned)

    if row.failed_indicators:
        row.status = Status.PARTIAL
    return row
