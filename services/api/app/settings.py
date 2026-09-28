from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuration via environment variables (CAFI-operated cloud project).

    Secrets (database password, OIDC client secret) come from the runtime's
    secret store, never from files in the repo.
    """

    model_config = SettingsConfigDict(env_prefix="CAFI_", env_file=".env", extra="ignore")

    database_url: str = "postgresql://cafi:cafi@localhost:5432/cafi_rs"
    # Keycloak (the PES system's IdP). Empty issuer = auth disabled (local dev).
    oidc_issuer: str = ""
    oidc_client_id: str = "cafi-rs-platform"
    cors_origins: list[str] = ["http://localhost:5173"]


settings = Settings()
