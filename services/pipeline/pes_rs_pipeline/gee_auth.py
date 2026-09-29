"""Materialise Google service-account credentials from the environment.

CAFI_RS_GEE_KEY_B64 is accepted in any of three shapes (the live environment
stores a raw PEM, despite the variable's name — observed Sept 2026):

1. base64-encoded service-account JSON (the intended format);
2. raw service-account JSON;
3. a raw PEM private key (possibly with literal ``\\n`` sequences), combined
   with CAFI_RS_GEE_SERVICE_ACCOUNT as the client_email.

The resolved key is written to a private temp file and
GOOGLE_APPLICATION_CREDENTIALS is pointed at it (unless already set, e.g. on
Cloud Run with workload identity, where no key exists at all).
"""

import base64
import json
import os
import tempfile

_PEM_MARK = "-----BEGIN"


def _key_json_from_env(raw: str, service_account: str) -> dict | None:
    text = raw.strip()
    if not text:
        return None
    if not text.startswith("{") and _PEM_MARK not in text:
        try:  # shape 1: base64 of JSON (or of a PEM)
            text = base64.b64decode(text, validate=True).decode()
        except Exception:  # noqa: BLE001 — fall through, maybe it's a bare PEM
            pass
    text = text.strip()
    if text.startswith("{"):  # shape 2: JSON
        return json.loads(text)
    if _PEM_MARK in text:  # shape 3: PEM + client_email from the env
        if not service_account:
            raise ValueError("PEM key needs CAFI_RS_GEE_SERVICE_ACCOUNT for client_email")
        pem = text.replace("\\n", "\n")
        if not pem.endswith("\n"):
            pem += "\n"
        return {
            "type": "service_account",
            "client_email": service_account,
            "private_key": pem,
            "token_uri": "https://oauth2.googleapis.com/token",
        }
    raise ValueError("unrecognised CAFI_RS_GEE_KEY_B64 format")


def materialise_gee_credentials(service_account: str) -> str | None:
    """Ensure GOOGLE_APPLICATION_CREDENTIALS points at a usable key file.

    Returns the path written, or None when nothing needed doing (variable
    absent, or ADC already configured). Idempotent per process.
    """
    if os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"):
        return None
    key = _key_json_from_env(os.environ.get("CAFI_RS_GEE_KEY_B64", ""), service_account)
    if key is None:
        return None
    fd, path = tempfile.mkstemp(prefix="gee-key-", suffix=".json")
    with os.fdopen(fd, "w") as fh:
        json.dump(key, fh)
    os.chmod(path, 0o600)
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = path
    return path
