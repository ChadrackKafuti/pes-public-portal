"""Temporal windows — spec §3, §11.3 and §11.7, implemented verbatim.

- Baseline: the five years before the application date,
  [max(app_ref - 5 years + 1 day, dataset_floor), app_ref].
- Current: [application_date, object_date] for monitoring visits; None for
  applications.
- Every interval end is clamped to today.
"""

from dataclasses import dataclass
from datetime import date, timedelta

from .config import DATASET_FLOORS
from .models import ObjectType, PesObject

DAYS_PER_YEAR = 365.25


@dataclass(frozen=True)
class Interval:
    start: date
    end: date

    @property
    def years(self) -> float:
        """Spec §11.3: years = max(1, (end - start) / 365.25)."""
        return max(1.0, (self.end - self.start).days / DAYS_PER_YEAR)


def _minus_years(d: date, years: int) -> date:
    try:
        return d.replace(year=d.year - years)
    except ValueError:  # 29 February
        return d.replace(year=d.year - years, day=28)


def baseline_window(
    app_ref: date, dataset: str, *, years: int = 5, today: date | None = None
) -> Interval:
    """The pre-enrolment baseline for one dataset, clamped to its floor (§11.7)."""
    floor = DATASET_FLOORS[dataset]
    start = max(_minus_years(app_ref, years) + timedelta(days=1), floor)
    end = min(app_ref, today or date.today())
    return Interval(start, end)


def current_window(obj: PesObject, *, today: date | None = None) -> Interval | None:
    """The current period; None for applications (spec §3)."""
    if obj.object_type is ObjectType.APPLICATION:
        return None
    end = min(obj.object_date, today or date.today())
    return Interval(obj.application_date, end)


def baseline_years_effective(interval: Interval) -> int:
    """`baseline_years` output field: round(years) after clamping (§11.3)."""
    return round(interval.years)
