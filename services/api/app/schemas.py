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
    country: str | None
    province: str | None
    implementing_org: str | None
    project_name: str | None
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


class FilterOptions(ApiModel):
    countries: list[str]
    provinces: list[str]
    organisations: list[str]
    projects: list[str]
    activities: list[str]


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


class GovLayerInfo(ApiModel):
    """One governance layer's production-filtered inventory."""

    layer: str
    total: int
    by_country: dict[str, int]
    last_loaded_utc: datetime | None


class GovDocumentOut(ApiModel):
    """One gov_documents row (public link, never a file we host)."""

    doc_uid: str
    title: str | None
    category_std: str | None
    file_name: str | None
    content_type: str | None
    size_bytes: int | None
    date_doc: datetime | None
    url: str | None
    src_system: str | None


class ProfileStage(ApiModel):
    name: str | None
    order: int | None
    total: int
    category: str  # active | rejected | archived | unknown
    status: str | None


class ProfileSpecies(ApiModel):
    name: str | None
    density_per_ha: float | None


class ProfileContract(ApiModel):
    code: str | None
    status: str | None
    start: date | None
    end: date | None
    duration_years: float | None
    declared_area_ha: float | None
    contracted_area_ha: float | None
    pct_elapsed: float | None
    days_remaining: int | None
    species: list[ProfileSpecies]


class ProfileVisits(ApiModel):
    expected: int | None
    completed: int
    last_date: date | None
    next_due: date | None
    overdue: bool | None


class ProfileFire(ApiModel):
    burned_5yr_ha: float | None
    burned_pct: float | None
    fire_alerts_5yr: int | None
    category: str | None  # low | moderate | high | very_high


class ProfilePerformance(ApiModel):
    achieved_ha: float | None
    gap_ha: float | None
    achieved_pct: float | None
    monitored_total_ha: float | None
    observed_trees: int | None
    observed_land_cover: str | None
    observed_land_cover_pct: float | None


class ProfileAreas(ApiModel):
    estimated_ha: float | None
    declared_ha: float | None
    contracted_ha: float | None
    achieved_ha: float | None


class ProfileBeneficiary(ApiModel):
    type: str | None
    status: str | None
    gender: str | None
    family_situation: str | None
    dependents: int | None
    community_members: int | None


class ProfileProject(ApiModel):
    name: str | None
    org: str | None
    org_acronym: str | None
    aggregator: str | None


class ProfileBaseline(ApiModel):
    """M11 — the remote-sensing baseline shown in the Overview panel."""

    parcel_area_ha: float | None
    tree_cover_ha: float | None
    defor_5yr_ha_yr: float | None
    baseline_years: int | None
    landcover_at_app: str | None
    landcover_at_app_pct: float | None
    landcover_current: str | None
    landcover_current_pct: float | None
    landcover_changed: bool | None
    series: list["AnnualPoint"] = []  # M13: annual tree-cover chart data


class ProfileOut(ApiModel):
    """The M7b application profile: v1's popup content, section by section."""

    application_id: str
    application_code: str | None
    application_date: date | None
    activity: str | None
    activity_group: str  # generic | agroforestry | reforestation | natural_regeneration
    stage: ProfileStage | None
    location: dict[str, str | None]
    beneficiary: ProfileBeneficiary | None
    project: ProfileProject
    contract: ProfileContract | None
    visits: ProfileVisits | None
    fire: ProfileFire | None
    performance: ProfilePerformance | None
    areas: ProfileAreas
    baseline: ProfileBaseline | None = None
    geometry_source: str | None
    last_sync: datetime | None


class AnalysesContract(ApiModel):
    """One contract row for the Analyses pickers (M7d)."""

    contract_code: str
    # Until the upcoming contract endpoint ships real contract codes, the
    # group's application code (CO54-BE113 style) is the display code (M15).
    application_code: str | None = None
    org: str | None
    project: str | None
    country: str | None
    village: str | None
    activity: str | None
    applications: int
    estimated_area_ha: float | None
    first_date: date | None
    # True when at least one application in the group already has its annual
    # tree-cover series computed (M21 — "ready to review" picker badge).
    has_series: bool = False


class AdminExceptionItem(ApiModel):
    """M20 — one skipped/failed parcel for the admin follow-up page."""

    object_id: str
    object_type: str | None
    reason: str
    area_gis: float | None
    occurrences: int
    last_seen: datetime | None
    application_code: str | None
    implementing_org: str | None
    country: str | None


class AdminExceptionsOut(ApiModel):
    summary: list[dict]
    items: list[AdminExceptionItem]


class IncidentItem(ApiModel):
    """M23 — one near-real-time disturbance incident."""

    incident_uid: str
    application_id: str
    kind: str  # 'deforestation' | 'fire'
    first_detected: date
    last_detected: date
    magnitude: float | None
    status: str  # open|responded|verified|dismissed|resolved
    status_note: str | None
    status_by: str | None
    status_utc: datetime | None
    updated_utc: datetime | None
    application_code: str | None
    implementing_org: str | None
    project_name: str | None
    country: str | None
    province: str | None
    pes_activity: str | None
    # M27 — photos of the application that arrived after first detection
    evidence_count: int = 0


class IncidentsOut(ApiModel):
    summary: dict[str, int]
    items: list[IncidentItem]


class IncidentUpdate(ApiModel):
    status: str
    note: str | None = None


class AnnualPoint(ApiModel):
    year: int
    tc_ha: float | None
    loss_ha: float | None
    # M25 — surrounding-landscape control, scaled to the parcel area
    control_tc_ha: float | None = None
    # M29b — fire-exclusion timeline + fragmentation (conservation/SFM)
    burned_ha: float | None = None
    patch_count: int | None = None
    edge_m_per_ha: float | None = None


class NdviPoint(ApiModel):
    """M29b — one month of the NDVI phenology curve."""

    month: date
    ndvi: float | None
    control_ndvi: float | None


class ScorecardEntry(ApiModel):
    """M24 — one activity-scorecard KPI with its traffic-light status."""

    key: str
    value: float | None
    unit: str | None
    status: str  # ok|watch|action|none
    target: float | None = None


class ContractAnalysis(ApiModel):
    """The contract-analysis payload: v1's sheet + description fields."""

    contract_code: str
    org: str | None
    project: str | None
    country: str | None
    village: str | None
    activity: str | None
    applications: int
    parcel_area_ha: float | None
    contracted_area_ha: float | None
    beneficiary_type: str | None
    start_date: date | None
    end_date: date | None
    series: list[AnnualPoint]
    # M25 — 1 m canopy model, area-weighted over the contract's parcels
    canopy_pct_gt3m: float | None = None
    canopy_mean_m: float | None = None
    # M24 — activity scorecard
    activity_group: str = "generic"
    scorecard: list[ScorecardEntry] = []
    overall_status: str = "none"


class PhotoOut(ApiModel):
    """One geotagged photo point (M7a; image via /api/photos/{uid}/image-url)."""

    photo_uid: str
    kind: str
    parent_id: str | None
    application_id: str | None
    application_code: str | None
    contract_code: str | None
    photo_index: int | None
    label: str | None
    lon: float
    lat: float
    mirrored: bool
    # M26 — photo intelligence (null until the AI pass has seen the photo)
    ai_scene: str | None = None
    ai_consistent: bool | None = None
    ai_tree_count: int | None = None
    ai_flags: str | None = None
    ai_summary: str | None = None


class AoiOverlap(ApiModel):
    """One governance feature intersecting the caller's AOI (M3)."""

    layer: str
    src_uid: str
    name: str | None
    reference: str | None
    iso3: str | None
    doc_count: int | None
    overlap_ha: float
    overlap_pct: float


class AoiResult(ApiModel):
    """POST /api/aoi answer: what governs the drawn polygon."""

    area_ha: float
    overlaps: list[AoiOverlap]
    by_layer: dict[str, float]


class AlertRow(ApiModel):
    """One monitoring visit with an active disturbance signal (M4)."""

    object_id: str
    object_date: date
    application_id: str
    application_code: str | None
    contract_code: str | None
    pes_activity: str | None
    country: str | None
    province: str | None
    defor_alerts_current: int | None
    fire_alerts_current: int | None
    defor_current_ha: float | None
    burned_area_current_ha: float | None
    processed_utc: datetime


class DashboardGroup(ApiModel):
    name: str
    applications: int
    area_ha: float | None


class DashboardMonth(ApiModel):
    month: str
    applications: int


class DashboardStatusCounts(ApiModel):
    ok: int
    partial: int
    partial_final: int


class DashboardStage(ApiModel):
    name: str
    order: int | None
    applications: int


class DashboardCount(ApiModel):
    name: str
    applications: int


class DashboardPes(ApiModel):
    applications: int
    parcel_area_ha: float | None
    tree_cover_ha: float | None
    visits: int
    status_counts: DashboardStatusCounts
    by_country: list[DashboardGroup]
    by_activity: list[DashboardGroup]
    by_month: list[DashboardMonth]
    by_stage: list[DashboardStage] = []
    by_gender: list[DashboardCount] = []
    fire_profile: list[DashboardCount] = []
    overdue: int | None = None


class DashboardGovLayer(ApiModel):
    layer: str
    count: int
    area_ha: float | None


class DashboardGovernance(ApiModel):
    by_layer: list[DashboardGovLayer]
    documents: int


class DashboardOut(ApiModel):
    """The M5 dashboard payload (one request feeds the page)."""

    pes: DashboardPes
    governance: DashboardGovernance


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
