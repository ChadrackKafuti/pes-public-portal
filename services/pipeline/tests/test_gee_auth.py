import base64
import json
import os

import pytest

from pes_rs_pipeline.gee_auth import materialise_gee_credentials

SA = "svc@example.iam.gserviceaccount.com"
PEM = "-----BEGIN PRIVATE KEY-----\\nMIIfake\\n-----END PRIVATE KEY-----"
KEY_JSON = {"type": "service_account", "client_email": SA, "private_key": "x",
            "token_uri": "https://oauth2.googleapis.com/token"}


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    monkeypatch.delenv("GOOGLE_APPLICATION_CREDENTIALS", raising=False)
    monkeypatch.delenv("CAFI_RS_GEE_KEY_B64", raising=False)


def _roundtrip(monkeypatch, value):
    monkeypatch.setenv("CAFI_RS_GEE_KEY_B64", value)
    path = materialise_gee_credentials(SA)
    assert path is not None and os.environ["GOOGLE_APPLICATION_CREDENTIALS"] == path
    with open(path) as fh:
        written = json.load(fh)
    os.unlink(path)
    return written


def test_base64_json(monkeypatch):
    written = _roundtrip(monkeypatch, base64.b64encode(json.dumps(KEY_JSON).encode()).decode())
    assert written == KEY_JSON


def test_raw_json(monkeypatch):
    assert _roundtrip(monkeypatch, json.dumps(KEY_JSON)) == KEY_JSON


def test_raw_pem_with_literal_newlines(monkeypatch):
    # The live environment's actual shape (observed Sept 2026).
    written = _roundtrip(monkeypatch, PEM)
    assert written["client_email"] == SA
    assert written["type"] == "service_account"
    assert "\\n" not in written["private_key"]  # literal \n expanded
    assert written["private_key"].startswith("-----BEGIN PRIVATE KEY-----\n")
    assert written["private_key"].endswith("-----END PRIVATE KEY-----\n")


def test_base64_of_pem(monkeypatch):
    written = _roundtrip(monkeypatch, base64.b64encode(PEM.encode()).decode())
    assert written["client_email"] == SA


def test_absent_variable_is_noop(monkeypatch):
    assert materialise_gee_credentials(SA) is None
    assert "GOOGLE_APPLICATION_CREDENTIALS" not in os.environ


def test_existing_adc_wins(monkeypatch, tmp_path):
    existing = tmp_path / "adc.json"
    existing.write_text("{}")
    monkeypatch.setenv("GOOGLE_APPLICATION_CREDENTIALS", str(existing))
    monkeypatch.setenv("CAFI_RS_GEE_KEY_B64", PEM)
    assert materialise_gee_credentials(SA) is None
    assert os.environ["GOOGLE_APPLICATION_CREDENTIALS"] == str(existing)


def test_pem_without_service_account_raises(monkeypatch):
    monkeypatch.setenv("CAFI_RS_GEE_KEY_B64", PEM)
    with pytest.raises(ValueError, match="client_email"):
        materialise_gee_credentials("")
