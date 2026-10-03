"""Hidden-record rules at the pipeline edge (M20) — the API's visibility
policy applied BEFORE any computation: archived/deleted records, rejected
applications and QA/test tenants are excluded from the indicator loop, the
annual pass and every derived calculation. The raw-payload mirror still
stores everything (the API's own filter reads it), so hiding stays
reversible without a refetch.
"""

from typing import Any

from .pes_api import _pick as _api_pick

_FLAG_KEYS = ["isdeleted", "deleted", "isarchived", "archived", "isremoved"]
_TRUE = {"1", "true", "yes", "oui", "y"}
_HIDDEN_WORDS = ("archiv", "delet", "supprim")
_APP_HIDDEN_WORDS = _HIDDEN_WORDS + ("reject",)
_APP_TEXT_KEYS = ["stage", "applicationstage", "stagename", "stagecategory",
                  "applicationstatus", "recordstatus"]
_VISIT_TEXT_KEYS = ["monitoringvisitstatus", "visitstatus", "stagecategory",
                    "recordstatus", "status"]
_HIDDEN_ORGS = {"xeptagonqatestproject"}


def _pick(record: dict, keys: list[str]) -> Any:
    lowered = {str(k).lower(): v for k, v in record.items()}
    for key in keys:
        v = lowered.get(key)
        if v not in (None, "", "null", "None"):
            return v
    return None


def _flagged(record: dict) -> bool:
    for key in _FLAG_KEYS:
        v = _pick(record, [key])
        if v is True or (v is not None and str(v).strip().lower() in _TRUE):
            return True
    return False


def _text_hidden(record: dict, keys: list[str], words: tuple[str, ...]) -> bool:
    for key in keys:
        v = _pick(record, [key])
        if v is not None and any(w in str(v).lower() for w in words):
            return True
    return False


def application_hidden(record: Any) -> bool:
    if not isinstance(record, dict):
        return False
    order = _pick(record, ["stageorder", "stageno", "stagenumber"])
    try:
        negative = order is not None and float(order) < 0
    except (TypeError, ValueError):
        negative = False
    org = _pick(record, ["implementingorgname"])
    project = _pick(record, ["projectname"])
    return (
        _flagged(record)
        or _text_hidden(record, _APP_TEXT_KEYS, _APP_HIDDEN_WORDS)
        or negative
        or any(
            v is not None and str(v).strip().lower() in _HIDDEN_ORGS
            for v in (org, project)
        )
    )


def visit_hidden(record: Any) -> bool:
    if not isinstance(record, dict):
        return False
    return _flagged(record) or _text_hidden(record, _VISIT_TEXT_KEYS, _HIDDEN_WORDS)


def split_visible(
    applications: list[dict], visits: list[dict]
) -> tuple[list[dict], list[dict], set[str]]:
    """(visible applications, visible visits, hidden application ids).

    A visit is hidden when flagged itself or when its application is."""
    hidden_ids = {
        str(_api_pick(a, "id"))
        for a in applications
        if _api_pick(a, "id") is not None and application_hidden(a)
    }
    visible_apps = [
        a for a in applications if str(_api_pick(a, "id")) not in hidden_ids
    ]
    visible_visits = [
        v
        for v in visits
        if not visit_hidden(v)
        and str(_api_pick(v, "application_ref")) not in hidden_ids
    ]
    return visible_apps, visible_visits, hidden_ids
