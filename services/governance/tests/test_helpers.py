from datetime import datetime

from cb_governance.config import VOCAB_STATUS, VOCAB_ZONE, pa_name_key
from cb_governance.helpers import (
    first_valid,
    map_vocab,
    ms_to_datetime,
    norm_text,
    parse_date_any,
    parse_int,
    parse_num,
)


def test_norm_text_strips_accents_and_punctuation():
    assert norm_text("Forêt communautaire (Mbaïki)") == "FORET COMMUNAUTAIRE MBAIKI"
    assert norm_text(None) == ""


def test_first_valid_skips_null_tokens():
    assert first_valid(None, "  ", "N/A", "value") == "value"
    assert first_valid("0.0", "-") is None


def test_parse_num_handles_locales():
    assert parse_num("1 234,5") == 1234.5
    assert parse_num("1,234.5") == 1234.5
    assert parse_num("env. 12ha") == 12.0
    assert parse_num("") is None
    assert parse_int("7.6") == 8


def test_parse_date_any_accepts_many_shapes():
    iso = parse_date_any("2023-05-17")
    assert ms_to_datetime(iso) == datetime(2023, 5, 17)
    assert ms_to_datetime(parse_date_any("17/05/2023")) == datetime(2023, 5, 17)
    assert ms_to_datetime(parse_date_any(2020)) == datetime(2020, 1, 1)
    assert ms_to_datetime(parse_date_any("9999-01-01")) is None  # sentinel outside 1900..2100
    assert parse_date_any(None) is None


def test_vocab_mapping():
    assert map_vocab("Convention définitive signée", VOCAB_STATUS) == "final"
    assert map_vocab("EXPIRÉ", VOCAB_STATUS) == "expired"
    assert map_vocab("something else entirely", VOCAB_STATUS) == "unknown"
    assert map_vocab("Série de conservation", VOCAB_ZONE, default="other") == "conservation"


def test_pa_name_key_reduces_to_proper_name():
    assert pa_name_key("Parc National de la Salonga") == pa_name_key("Salonga National Park")
