"""Object model — spec §3 key concepts.

One *object* is a PES application or monitoring visit; each produces one
output row (`pes_rs_objects`). Kept dataclass-plain so the model is usable
without any I/O dependency.
"""

from dataclasses import dataclass, field
from datetime import date
from enum import Enum


class ObjectType(str, Enum):
    APPLICATION = "application"
    MONITORING_VISIT = "monitoring_visit"


class GeomSource(str, Enum):
    POLYGON = "polygon"
    BUFFERED_POINT = "buffered_point"
    POLYGON_INHERITED = "polygon_inherited"
    BUFFERED_POINT_INHERITED = "buffered_point_inherited"


class Status(str, Enum):
    OK = "ok"
    PARTIAL = "partial"
    PARTIAL_FINAL = "partial_final"


@dataclass
class PesObject:
    """A normalised application or monitoring visit (spec §4 step 3)."""

    object_id: str
    object_type: ObjectType
    object_date: date
    application_date: date  # own date for applications; parent's for visits
    application_id: str
    pes_activity: str | None = None
    shape_wkt: str | None = None  # polygon geometry as delivered by the PES API
    point: tuple[float, float] | None = None  # lon, lat
    estimated_area_ha: float | None = None


@dataclass
class IndicatorRow:
    """One `pes_rs_objects` row (spec §6.1). None = not measured, never zero."""

    object_id: str
    object_type: ObjectType
    object_date: date
    pes_activity: str | None
    parcel_area_ha: float
    geom_source: GeomSource
    tree_cover_ha: float | None = None
    defor_5yr_ha_yr: float | None = None
    defor_current_ha: float | None = None
    defor_alerts_5yr: int | None = None
    defor_alerts_current: int | None = None
    fire_alerts_5yr: int | None = None
    fire_alerts_current: int | None = None
    burned_area_5yr_ha: float | None = None
    burned_area_current_ha: float | None = None
    current_start: date | None = None
    tc_window_days: int | None = None
    tc_coverage: float | None = None
    baseline_years: int | None = None
    status: Status = Status.OK
    failed_indicators: list[str] = field(default_factory=list)
    attempts: int = 0
