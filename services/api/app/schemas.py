"""Response models.

camelCase JSON to match the @cafi/shared TypeScript types; None keeps the
spec §7 meaning — not measured, never zero.
"""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


def to_camel(name: str) -> str:
    """snake_case -> camelCase, keeping digit-led segments intact so
    `fire_alerts_5yr` becomes `fireAlerts5yr` (matching @cafi/shared),
    not pydantic's `fireAlerts5Yr`."""
    head, *rest = name.split("_")
    return head + "".join(part[:1].upper() + part[1:] for part in rest)


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class ApplicationSummary(ApiModel):
    application_id: str
    application_code: str | None
    contract_code: str | None
    application_date: date
    pes_activity: str | None
    estimated_area_ha: float | None
    parcel_area_ha: float | None
    tree_cover_ha: float | None
    defor_5yr_ha_yr: float | None
    status: str | None
    visit_count: int
    last_processed_utc: datetime | None


class ApplicationList(ApiModel):
    items: list[ApplicationSummary]
    total: int


class IndicatorRowOut(ApiModel):
    """One pes_rs_objects row (spec §6.1)."""

    object_id: str
    object_type: str
    object_date: date
    application_code: str | None
    contract_code: str | None
    pes_activity: str | None
    parcel_area_ha: float
    tree_cover_ha: float | None
    defor_5yr_ha_yr: float | None
    defor_current_ha: float | None
    defor_alerts_5yr: int | None
    defor_alerts_current: int | None
    fire_alerts_5yr: int | None
    fire_alerts_current: int | None
    burned_area_5yr_ha: float | None
    burned_area_current_ha: float | None
    current_start: date | None
    geom_source: str
    tc_window_days: int | None
    tc_coverage: float | None
    baseline_years: int | None
    status: str
    failed_indicators: list[str]
    processed_utc: datetime


class RunHealth(ApiModel):
    run_id: int
    start_utc: datetime
    end_utc: datetime | None
    duration_s: float | None
    fetched_app: int | None
    fetched_mon: int | None
    selected: int | None
    ok: int | None
    partial: int | None
    skipped: int | None
    queued: int | None
    stopped_reason: str | None
