"""Auth-layer tests: real RS256 tokens signed with an in-test keypair, the
JWKS cache monkeypatched to serve its public key."""

import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app import auth
from app.settings import settings

ISSUER = "https://sso.test/realms/UNPES"
CLIENT = "cafi-rs-platform"

_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _token(**overrides) -> str:
    claims = {
        "iss": ISSUER,
        "sub": "user-1",
        "preferred_username": "verifier",
        "azp": CLIENT,
        "aud": "account",
        "exp": int(time.time()) + 300,
        "realm_access": {"roles": ["default-roles-unpes", "rs-staff"]},
    }
    claims.update(overrides)
    return jwt.encode(claims, _key, algorithm="RS256", headers={"kid": "test-kid"})


@pytest.fixture()
def oidc_enabled(monkeypatch):
    monkeypatch.setattr(settings, "oidc_issuer", ISSUER)
    monkeypatch.setattr(settings, "oidc_client_id", CLIENT)
    monkeypatch.setattr(auth._jwks, "key_for", lambda kid: _key.public_key())
    yield


def test_auth_disabled_without_issuer(client):
    # settings.oidc_issuer defaults to "" in tests -> anonymous access.
    assert client.get("/api/applications").status_code == 200


def test_missing_token_rejected(client, oidc_enabled):
    r = client.get("/api/applications")
    assert r.status_code == 401
    assert r.headers["WWW-Authenticate"].startswith("Bearer")


def test_valid_token_accepted(client, oidc_enabled):
    r = client.get("/api/applications", headers={"Authorization": f"Bearer {_token()}"})
    assert r.status_code == 200


def test_expired_token_rejected(client, oidc_enabled):
    t = _token(exp=int(time.time()) - 10)
    assert client.get(
        "/api/applications", headers={"Authorization": f"Bearer {t}"}
    ).status_code == 401


def test_wrong_issuer_rejected(client, oidc_enabled):
    t = _token(iss="https://sso.evil/realms/other")
    assert client.get(
        "/api/applications", headers={"Authorization": f"Bearer {t}"}
    ).status_code == 401


def test_wrong_client_rejected(client, oidc_enabled):
    t = _token(azp="another-client", aud="account")
    assert client.get(
        "/api/applications", headers={"Authorization": f"Bearer {t}"}
    ).status_code == 401


def test_client_in_aud_accepted(client, oidc_enabled):
    t = _token(azp="other", aud=[CLIENT, "account"])
    assert client.get(
        "/api/applications", headers={"Authorization": f"Bearer {t}"}
    ).status_code == 200


def test_health_stays_open(client, oidc_enabled):
    assert client.get("/api/health").status_code == 200
