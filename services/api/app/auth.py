"""OIDC bearer-token authentication against Keycloak.

Every data endpoint requires a valid access token from the platform's realm
(design doc §3.2: staff tier). Validation is local: RS256 signature against
the realm's JWKS (cached, refreshed once on unknown kid), issuer and expiry.
Keycloak access tokens typically carry aud=["account", ...] rather than the
requesting client, so the client binding is checked via azp/aud leniently.

When no issuer is configured (CAFI_OIDC_ISSUER empty), authentication is
DISABLED and every request runs as an anonymous dev principal — local
development and tests only; production always sets the issuer.
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


class _JwksCache:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._keys: dict[str, object] = {}
        self._fetched_at = 0.0

    def _refresh(self) -> None:
        url = f"{settings.oidc_issuer.rstrip('/')}/protocol/openid-connect/certs"
        data = httpx.get(url, timeout=10).raise_for_status().json()
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


_jwks = _JwksCache()


def _validate(token: str) -> Principal:
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
        raise HTTPException(
            status_code=401,
            detail=str(exc),
            headers={"WWW-Authenticate": 'Bearer error="invalid_token"'},
        ) from exc

    client = settings.oidc_client_id
    aud = claims.get("aud") or []
    aud = [aud] if isinstance(aud, str) else aud
    if client and claims.get("azp") != client and client not in aud:
        raise HTTPException(
            status_code=401,
            detail="token not issued for this client",
            headers={"WWW-Authenticate": 'Bearer error="invalid_token"'},
        )

    return Principal(
        subject=claims.get("sub", ""),
        username=claims.get("preferred_username"),
        roles=list((claims.get("realm_access") or {}).get("roles", [])),
    )


def require_user(request: Request) -> Principal:
    """FastAPI dependency guarding the staff-tier endpoints."""
    if not settings.oidc_issuer:
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
