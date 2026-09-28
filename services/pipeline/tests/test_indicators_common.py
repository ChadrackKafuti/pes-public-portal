from datetime import date

from pes_rs_pipeline.indicators.common import (
    date_to_serial,
    m2_to_ha,
    radd_decode,
    tc_window_ladder,
)


def test_date_to_serial():
    assert date_to_serial(date(2024, 1, 1)) == 2024001
    assert date_to_serial(date(2024, 12, 31)) == 2024366  # leap year


def test_radd_decode_matches_spec_formula():
    # yyDDD 24051 = day 51 of 2024
    assert radd_decode(24051) == 2024051
    assert radd_decode(19365) == 2019365
    # decoded values compare correctly against date serials
    assert date_to_serial(date(2024, 2, 20)) == radd_decode(24051)


def test_window_ladder_starts_at_configured_window():
    assert tc_window_ladder(7) == (7, 14, 30, 60, 120)
    assert tc_window_ladder(30) == (30, 60, 120)
    assert tc_window_ladder(365) == (365,)  # never empty


def test_m2_to_ha():
    assert m2_to_ha(10_000) == 1.0
