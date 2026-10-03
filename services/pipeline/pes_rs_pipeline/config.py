"""Pipeline configuration — defaults are the RS specification §8 verbatim."""

from datetime import date

from pydantic_settings import BaseSettings, SettingsConfigDict


class PipelineConfig(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CAFI_RS_", env_file=".env", extra="ignore")

    # Spec §8
    tc_window_days: int = 7
    min_coverage_frac: float = 0.9
    baseline_years: int = 5
    alert_window_years: int = 5
    max_area_ha: float = 5000.0
    tile_threshold_ha: float = 1000.0
    max_run_minutes: int = 15
    max_partial_retries: int = 4
    max_exception_retries: int = 5
    lock_ttl_minutes: int = 40
    # Spec §11.2
    prob_threshold: float = 0.5
    # Spec §11.4
    radd_min_confidence: int = 2
    # RADD alerts collection (WUR); see gee-community-catalog.org/projects/radd/
    radd_asset: str = "projects/radar-wur/raddalert/v1"

    # Upstream: the PES Open API (Keycloak client credentials come from the
    # runtime secret store, per spec §2.1 — never stored in the tool).
    pes_api_base: str = ""
    pes_oidc_token_url: str = ""

    database_url: str = "postgresql://cafi:cafi@localhost:5432/cafi_rs"
    gee_service_account: str = ""

    # Geotagged-photo mirror (M7a). Empty URL or key disables image mirroring
    # (photo rows are still recorded with their expiring source URLs).
    supabase_url: str = ""
    supabase_service_key: str = ""
    photos_bucket: str = "pes-photos"
    photo_mirror_budget_s: int = 300
    max_photo_bytes: int = 15_000_000

    # Annual indicators (M7d): Dynamic World tree-cover series + land-cover
    # classes; the backlog drains in each run's leftover time budget.
    annual_start_year: int = 2016
    # High enough that an idle-main run drains as much as its time allows
    # (the cap, not the clock, bounded earlier runs at ~150/run — M19).
    annual_backlog_limit: int = 600
    # Minutes of each run held back from the main indicator loop so the
    # annual pass always makes progress — without it, a large main backlog
    # (e.g. after a geometry-hash change) starves the series for days (M15).
    annual_reserve_minutes: int = 5

    # Near-real-time incidents (M23): recent-window RADD + VIIRS checks on a
    # rotating, stalest-first slice of the portfolio each run.
    nrt_defor_days: int = 30
    nrt_fire_days: int = 14
    nrt_recheck_hours: int = 12
    nrt_batch_limit: int = 400
    nrt_reserve_minutes: int = 4

    # Canopy height + counterfactual controls (M25). The canopy model is a
    # static ~2020 snapshot: computed once per parcel. Controls compare the
    # parcel's annual tree-cover trend against the surrounding annulus.
    canopy_asset: str = "projects/meta-forest-monitoring-okw37/assets/CanopyHeight"
    control_inner_m: int = 100
    control_outer_m: int = 1500

    # Photo intelligence (M26): one Claude vision pass over each mirrored
    # geotagged photo. Empty API key disables the pass entirely.
    anthropic_api_key: str = ""
    photo_ai_model: str = "claude-opus-5-5"
    photo_ai_budget_s: int = 180
    photo_ai_batch: int = 40


# Spec §11.7 — dataset floors.
DATASET_FLOORS: dict[str, date] = {
    "dynamic_world": date(2016, 1, 1),
    "radd": date(2019, 1, 1),
    "viirs": date(2023, 9, 1),
    "modis_burned_area": date(2000, 11, 1),
}
