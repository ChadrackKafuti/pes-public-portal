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


def test_governance_routes_also_guarded(client, oidc_enabled):
    assert client.get("/api/governance/layers").status_code == 401
    assert client.get("/api/governance/concessions.geojson").status_code == 401


# ---- Supabase provider ------------------------------------------------------

SUPABASE_URL = "https://demo-ref.supabase.co"
SUPABASE_ISS = f"{SUPABASE_URL}/auth/v1"
SUPABASE_SECRET = "test-jwt-secret-0123456789abcdef0123456789abcdef"

_ec_key = None


def _ec():
    global _ec_key
    if _ec_key is None:
        from cryptography.hazmat.primitives.asymmetric import ec

        _ec_key = ec.generate_private_key(ec.SECP256R1())
    return _ec_key


def _sb_token(alg="HS256", **overrides) -> str:
    claims = {
        "iss": SUPABASE_ISS,
        "sub": "sb-user-1",
        "aud": "authenticated",
        "role": "authenticated",
        "email": "staff@cafi.org",
        "app_metadata": {"role": "admin"},
        "exp": int(time.time()) + 300,
    }
    claims.update(overrides)
    if alg == "HS256":
        return jwt.encode(claims, SUPABASE_SECRET, algorithm="HS256")
    return jwt.encode(claims, _ec(), algorithm="ES256", headers={"kid": "sb-kid"})


@pytest.fixture()
def supabase_hs256(monkeypatch):
    monkeypatch.setattr(settings, "supabase_url", SUPABASE_URL)
    monkeypatch.setattr(settings, "supabase_jwt_secret", SUPABASE_SECRET)
    yield


@pytest.fixture()
def supabase_jwks(monkeypatch):
    monkeypatch.setattr(settings, "supabase_url", SUPABASE_URL)
    monkeypatch.setattr(settings, "supabase_jwt_secret", "")
    monkeypatch.setattr(auth._supabase_jwks, "key_for", lambda kid: _ec().public_key())
    yield


def test_supabase_hs256_accepted(client, supabase_hs256):
    r = client.get(
        "/api/applications", headers={"Authorization": f"Bearer {_sb_token()}"}
    )
    assert r.status_code == 200


def test_supabase_wrong_secret_rejected(client, supabase_hs256):
    t = jwt.encode(
        {"iss": SUPABASE_ISS, "sub": "x", "aud": "authenticated",
         "exp": int(time.time()) + 300},
        "another-secret-another-secret-another-secret",
        algorithm="HS256",
    )
    assert client.get(
        "/api/applications", headers={"Authorization": f"Bearer {t}"}
    ).status_code == 401


def test_supabase_wrong_issuer_rejected(client, supabase_hs256):
    t = _sb_token(iss="https://other.supabase.co/auth/v1")
    assert client.get(
        "/api/applications", headers={"Authorization": f"Bearer {t}"}
    ).status_code == 401


def test_supabase_wrong_audience_rejected(client, supabase_hs256):
    t = _sb_token(aud="anon")
    assert client.get(
        "/api/applications", headers={"Authorization": f"Bearer {t}"}
    ).status_code == 401


def test_supabase_expired_rejected(client, supabase_hs256):
    t = _sb_token(exp=int(time.time()) - 10)
    assert client.get(
        "/api/applications", headers={"Authorization": f"Bearer {t}"}
    ).status_code == 401


def test_supabase_jwks_es256_accepted(client, supabase_jwks):
    r = client.get(
        "/api/applications",
        headers={"Authorization": f"Bearer {_sb_token(alg='ES256')}"},
    )
    assert r.status_code == 200


def test_both_providers_coexist(client, oidc_enabled, supabase_hs256):
    ok_kc = client.get("/api/applications", headers={"Authorization": f"Bearer {_token()}"})
    ok_sb = client.get("/api/applications", headers={"Authorization": f"Bearer {_sb_token()}"})
    assert (ok_kc.status_code, ok_sb.status_code) == (200, 200)
    # a token from an unknown issuer is rejected even with both providers up
    t = _sb_token(iss="https://stranger.example/auth/v1")
    assert client.get(
        "/api/applications", headers={"Authorization": f"Bearer {t}"}
    ).status_code == 401
