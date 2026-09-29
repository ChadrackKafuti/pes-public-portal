"""Incremental selection — spec §3 "incremental processing" and §4 step 4.

Reprocess only records that are new, geometry/date-changed, newly ready
(a deferred future visit whose object date has arrived), or due for retry.
Everything else is skipped. The decision is pure: the store fetches state,
this module decides.
"""

from dataclasses import dataclass
from datetime import date
from enum import Enum

from .config import PipelineConfig
from .geometry import geom_input_hash
from .models import PesObject, Status


@dataclass(frozen=True)
class StoredState:
    """What the database remembers about one object."""

    geom_input_hash: str
    object_date: date
    status: Status
    attempts: int
    next_attempt_date: date | None = None  # from the queue, when queued for retry


class Decision(str, Enum):
    PROCESS = "process"  # new, changed, newly ready, or retry due
    SKIP_UNCHANGED = "skip_unchanged"
    SKIP_RETRY_WAIT = "skip_retry_wait"  # queued, next_attempt_date in the future
    SKIP_RETRY_EXHAUSTED = "skip_retry_exhausted"  # partial_final (spec §6.1)


def decide(
    obj: PesObject, stored: StoredState | None, config: PipelineConfig, today: date
) -> Decision:
    if stored is None:
        return Decision.PROCESS

    changed = (
        stored.geom_input_hash != geom_input_hash(obj.shape_wkt, obj.point)
        or stored.object_date != obj.object_date
    )
    if changed:
        return Decision.PROCESS  # attempts reset on change (new work, not a retry)

    if stored.status is Status.OK:
        return Decision.SKIP_UNCHANGED
    if stored.status is Status.PARTIAL_FINAL:
        return Decision.SKIP_RETRY_EXHAUSTED
    # PARTIAL: retry until the limit, respecting the queue's backoff date.
    if stored.attempts >= config.max_partial_retries:
        return Decision.SKIP_RETRY_EXHAUSTED
    if stored.next_attempt_date is not None and stored.next_attempt_date > today:
        return Decision.SKIP_RETRY_WAIT
    return Decision.PROCESS
