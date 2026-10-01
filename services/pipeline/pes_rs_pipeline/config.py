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
    annual_backlog_limit: int = 150


# Spec §11.7 — dataset floors.
DATASET_FLOORS: dict[str, date] = {
    "dynamic_world": date(2016, 1, 1),
    "radd": date(2019, 1, 1),
    "viirs": date(2023, 9, 1),
    "modis_burned_area": date(2000, 11, 1),
}
