"""Archived / deleted record filtering (M14).

Sources mark retirement in two ways: boolean-ish flags (IsDeleted, Archived)
and status/stage text (the v1 stage table's "Archived" stage, status strings
like "Deleted" / "Supprimé"). Every read path that serves applications,
contracts or monitoring visits filters through here so retired records never
reach the frontend. Matching is tolerant (case-insensitive, FR spellings)
but scoped to retirement words — "Rejected" stays visible, as in v1.
"""

from typing import Any

from .profile import _pick

_FLAG_KEYS = ["isdeleted", "deleted", "isarchived", "archived", "isremoved"]
_TRUE = {"1", "true", "yes", "oui", "y"}

_APP_TEXT_KEYS = ["stage", "applicationstage", "stagename", "stagecategory",
                  "applicationstatus", "recordstatus"]
_VISIT_TEXT_KEYS = ["monitoringvisitstatus", "visitstatus", "stagecategory",
                    "recordstatus", "status"]
_CONTRACT_TEXT_KEYS = ["contractstatus"]

_HIDDEN_WORDS = ("archiv", "delet", "supprim")


def _flagged(payload: dict) -> bool:
    for key in _FLAG_KEYS:
        v = _pick(payload, [key])
        if v is True or (v is not None and str(v).strip().lower() in _TRUE):
            return True
    return False


def _text_hidden(payload: dict, keys: list[str]) -> bool:
    for key in keys:
        v = _pick(payload, [key])
        if v is not None and any(w in str(v).lower() for w in _HIDDEN_WORDS):
            return True
    return False


def application_hidden(payload: Any) -> bool:
    if not isinstance(payload, dict):
        return False
    return _flagged(payload) or _text_hidden(payload, _APP_TEXT_KEYS)


def visit_hidden(payload: Any) -> bool:
    if not isinstance(payload, dict):
        return False
    return _flagged(payload) or _text_hidden(payload, _VISIT_TEXT_KEYS)


def contract_hidden(payload: Any) -> bool:
    """The contract itself (status on its selected visit record)."""
    if not isinstance(payload, dict):
        return False
    return _text_hidden(payload, _CONTRACT_TEXT_KEYS)


def hidden_application_ids(conn) -> set[str]:
    """Applications whose raw payload marks them archived/deleted."""
    return {
        str(rid)
        for rid, payload in conn.execute(
            "SELECT record_id, payload FROM pes_raw_records WHERE kind = 'application'"
        ).fetchall()
        if application_hidden(payload)
    }
