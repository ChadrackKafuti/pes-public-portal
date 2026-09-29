from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuration via environment variables (CAFI-operated cloud project).

    Secrets (database password, OIDC client secret) come from the runtime's
    secret store, never from files in the repo.
    """

    model_config = SettingsConfigDict(env_prefix="CAFI_", env_file=".env", extra="ignore")

    database_url: str = "postgresql://cafi:cafi@localhost:5432/cafi_rs"
    # Keycloak (the PES system's IdP). Empty issuer = provider disabled.
    oidc_issuer: str = ""
    oidc_client_id: str = "cafi-rs-platform"
    # Supabase Auth (CAFI-managed users, Ground Impact pattern). Empty URL =
    # provider disabled. With no JWT secret set, tokens are verified against
    # the project's JWKS (asymmetric signing keys); the secret enables the
    # legacy HS256 verification instead.
    supabase_url: str = ""
    supabase_jwt_secret: str = ""
    cors_origins: list[str] = ["http://localhost:5173"]

    @property
    def auth_enabled(self) -> bool:
        return bool(self.oidc_issuer or self.supabase_url)


settings = Settings()
