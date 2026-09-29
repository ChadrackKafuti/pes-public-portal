"""Pure indicator helpers — the spec §11 pieces that need no Earth Engine."""

from datetime import date

#: Widening ladder for the Dynamic World imagery window (spec §11.2): the
#: shortest window meeting tc_coverage >= min_coverage_frac wins. Starts at
#: the configured tc_window_days (7 by default).
TC_WINDOW_LADDER_DAYS: tuple[int, ...] = (7, 14, 30, 60, 120)


def tc_window_ladder(initial_days: int) -> tuple[int, ...]:
    """The ladder starting from the configured initial window."""
    return tuple(d for d in TC_WINDOW_LADDER_DAYS if d >= initial_days) or (initial_days,)


def date_to_serial(d: date) -> int:
    """A date as yyyyDDD, the comparison space of spec §11.4.

    RADD pixels store yyDDD; the spec decodes them with
    serial = (floor(Date/1000) + 2000) * 1000 + (Date mod 1000),
    which lands in this same yyyyDDD space.
    """
    return d.year * 1000 + d.timetuple().tm_yday


def radd_decode(pixel_value: int) -> int:
    """Spec §11.4: raster yyDDD -> yyyyDDD serial."""
    return (pixel_value // 1000 + 2000) * 1000 + pixel_value % 1000


def m2_to_ha(area_m2: float) -> float:
    """Spec §11.1: area(M) sums pixel areas in m² and divides by 10,000."""
    return area_m2 / 10_000.0
