"""Bearer-token authentication: Keycloak OIDC and/or Supabase Auth.

Every data endpoint requires a valid access token from one of the
configured providers (design doc §3.2: staff tier). Validation is local:

- Keycloak (CAFI_OIDC_ISSUER): RS256 against the realm's JWKS (cached,
  refreshed once on unknown kid), issuer and expiry. Keycloak access
  tokens typically carry aud=["account", ...] rather than the requesting
  client, so the client binding is checked via azp/aud leniently.
- Supabase (CAFI_SUPABASE_URL): the Ground Impact pattern — CAFI-managed
  users in a Supabase project. ES256/RS256 against the project's JWKS
  (asymmetric signing keys), or HS256 with CAFI_SUPABASE_JWT_SECRET
  (legacy secret) when that is set; audience "authenticated".

The token's iss claim picks the verifier, so both providers can be live
at once (e.g. Supabase now, Keycloak once the PES client is registered).
With neither configured, authentication is DISABLED and every request
runs as an anonymous dev principal — local development and tests only.
"""

import logging
import threading
import time
from dataclasses import dataclass, field

import httpx
import jwt
from fastapi import Depends, HTTPException, Request

from .settings import settings

log = logging.getLogger(__name__)

_JWKS_TTL_S = 3600


@dataclass
class Principal:
    subject: str
    username: str | None
    roles: list[str] = field(default_factory=list)
    anonymous: bool = False


ANONYMOUS = Principal(subject="anonymous", username=None, anonymous=True)


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=401,
        detail=detail,
        headers={"WWW-Authenticate": 'Bearer error="invalid_token"'},
    )


class _JwksCache:
    def __init__(self, url_fn) -> None:
        self._url_fn = url_fn  # callable: settings can change under tests
        self._lock = threading.Lock()
        self._keys: dict[str, object] = {}
        self._fetched_at = 0.0

    def _refresh(self) -> None:
        data = httpx.get(self._url_fn(), timeout=10).raise_for_status().json()
        self._keys = {
            k["kid"]: jwt.PyJWK(k).key for k in data.get("keys", []) if "kid" in k
        }
        self._fetched_at = time.monotonic()

    def key_for(self, kid: str):
        with self._lock:
            stale = time.monotonic() - self._fetched_at > _JWKS_TTL_S
            if kid not in self._keys or stale:
                self._refresh()
            return self._keys.get(kid)


def _keycloak_jwks_url() -> str:
    return f"{settings.oidc_issuer.rstrip('/')}/protocol/openid-connect/certs"


def _supabase_issuer() -> str:
    return f"{settings.supabase_url.rstrip('/')}/auth/v1"


def _supabase_jwks_url() -> str:
    return f"{_supabase_issuer()}/.well-known/jwks.json"


_jwks = _JwksCache(_keycloak_jwks_url)
_supabase_jwks = _JwksCache(_supabase_jwks_url)


def _validate_keycloak(token: str) -> Principal:
    try:
        kid = jwt.get_unverified_header(token).get("kid")
        key = _jwks.key_for(kid) if kid else None
        if key is None:
            raise jwt.InvalidTokenError("unknown signing key")
        claims = jwt.decode(
            token,
            key=key,
            algorithms=["RS256"],
            issuer=settings.oidc_issuer.rstrip("/"),
            options={"verify_aud": False},  # checked leniently below
        )
    except jwt.InvalidTokenError as exc:
        raise _unauthorized(str(exc)) from exc

    client = settings.oidc_client_id
    aud = claims.get("aud") or []
    aud = [aud] if isinstance(aud, str) else aud
    if client and claims.get("azp") != client and client not in aud:
        raise _unauthorized("token not issued for this client")

    return Principal(
        subject=claims.get("sub", ""),
        username=claims.get("preferred_username"),
        roles=list((claims.get("realm_access") or {}).get("roles", [])),
    )


def _validate_supabase(token: str) -> Principal:
    try:
        if settings.supabase_jwt_secret:
            key = settings.supabase_jwt_secret
            algorithms = ["HS256"]
        else:
            kid = jwt.get_unverified_header(token).get("kid")
            key = _supabase_jwks.key_for(kid) if kid else None
            if key is None:
                raise jwt.InvalidTokenError("unknown signing key")
            algorithms = ["ES256", "RS256"]
        claims = jwt.decode(
            token,
            key=key,
            algorithms=algorithms,
            issuer=_supabase_issuer(),
            audience="authenticated",
        )
    except jwt.InvalidTokenError as exc:
        raise _unauthorized(str(exc)) from exc

    app_meta = claims.get("app_metadata") or {}
    role = app_meta.get("role")
    return Principal(
        subject=claims.get("sub", ""),
        username=claims.get("email"),
        roles=[role] if role else [],
    )


def _validate(token: str) -> Principal:
    """Route by the token's (unverified) issuer; each verifier then checks
    the issuer again as part of signature validation."""
    try:
        iss = jwt.decode(token, options={"verify_signature": False}).get("iss", "")
    except jwt.InvalidTokenError as exc:
        raise _unauthorized(str(exc)) from exc
    if settings.supabase_url and iss == _supabase_issuer():
        return _validate_supabase(token)
    if settings.oidc_issuer:
        return _validate_keycloak(token)
    raise _unauthorized("token issuer not accepted")


def require_user(request: Request) -> Principal:
    """FastAPI dependency guarding the staff-tier endpoints."""
    if not settings.auth_enabled:
        return ANONYMOUS
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="missing bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return _validate(header.removeprefix("Bearer "))


CurrentUser = Depends(require_user)
