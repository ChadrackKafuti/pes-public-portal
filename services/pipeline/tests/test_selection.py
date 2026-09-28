from datetime import date

from pes_rs_pipeline.config import PipelineConfig
from pes_rs_pipeline.geometry import geom_input_hash
from pes_rs_pipeline.models import ObjectType, PesObject, Status
from pes_rs_pipeline.selection import Decision, StoredState, decide

TODAY = date(2026, 9, 28)
CONFIG = PipelineConfig()


def _obj(**kw) -> PesObject:
    base = dict(
        object_id="A1",
        object_type=ObjectType.APPLICATION,
        object_date=date(2024, 6, 1),
        application_date=date(2024, 6, 1),
        application_id="A1",
        shape_wkt="POLYGON((0 0,1 0,1 1,0 0))",
    )
    base.update(kw)
    return PesObject(**base)


def _stored(obj: PesObject, **kw) -> StoredState:
    base = dict(
        geom_input_hash=geom_input_hash(obj.shape_wkt, obj.point),
        object_date=obj.object_date,
        status=Status.OK,
        attempts=0,
        next_attempt_date=None,
    )
    base.update(kw)
    return StoredState(**base)


def test_new_object_is_processed():
    assert decide(_obj(), None, CONFIG, TODAY) is Decision.PROCESS


def test_unchanged_ok_object_is_skipped():
    obj = _obj()
    assert decide(obj, _stored(obj), CONFIG, TODAY) is Decision.SKIP_UNCHANGED


def test_geometry_change_reprocesses():
    obj = _obj(shape_wkt="POLYGON((0 0,2 0,2 2,0 0))")
    stored = _stored(_obj())  # hash of the OLD shape
    assert decide(obj, stored, CONFIG, TODAY) is Decision.PROCESS


def test_date_change_reprocesses():
    obj = _obj(object_date=date(2024, 7, 1))
    stored = _stored(_obj())
    assert decide(obj, stored, CONFIG, TODAY) is Decision.PROCESS


def test_partial_retries_until_limit():
    obj = _obj()
    assert decide(obj, _stored(obj, status=Status.PARTIAL, attempts=1), CONFIG, TODAY) \
        is Decision.PROCESS
    assert decide(
        obj,
        _stored(obj, status=Status.PARTIAL, attempts=CONFIG.max_partial_retries),
        CONFIG, TODAY,
    ) is Decision.SKIP_RETRY_EXHAUSTED


def test_partial_final_never_retried():
    obj = _obj()
    assert decide(obj, _stored(obj, status=Status.PARTIAL_FINAL, attempts=2), CONFIG, TODAY) \
        is Decision.SKIP_RETRY_EXHAUSTED


def test_retry_respects_backoff_date():
    obj = _obj()
    waiting = _stored(
        obj, status=Status.PARTIAL, attempts=1, next_attempt_date=date(2026, 10, 1)
    )
    assert decide(obj, waiting, CONFIG, TODAY) is Decision.SKIP_RETRY_WAIT
    due = _stored(obj, status=Status.PARTIAL, attempts=1, next_attempt_date=TODAY)
    assert decide(obj, due, CONFIG, TODAY) is Decision.PROCESS


def test_change_beats_exhaustion():
    # New geometry resets the record even after partial_final (spec §3: changed).
    obj = _obj(shape_wkt="POLYGON((0 0,3 0,3 3,0 0))")
    stored = _stored(_obj(), status=Status.PARTIAL_FINAL, attempts=5)
    assert decide(obj, stored, CONFIG, TODAY) is Decision.PROCESS
