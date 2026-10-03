"""Activity-aware contract scorecards (M24).

Each PES activity on the land-use spectrum has its own success criteria;
the scorecard turns the indicators we already compute into a short list
of KPIs with a traffic-light status, so a program officer can scan a
hundred contracts for the ones that need attention. Statuses: 'ok',
'watch', 'action', or 'none' when the input is not yet measured —
blank is never zero (spec §7).
"""

from dataclasses import dataclass


@dataclass
class ScoreInputs:
    parcel_area_ha: float | None = None
    contracted_area_ha: float | None = None
    tc_latest: float | None = None  # contract-summed series, latest year
    tc_prev: float | None = None
    latest_year: int | None = None
    defor_current_ha: float | None = None
    defor_alerts_current: int | None = None
    fire_alerts_current: int | None = None
    burned_current_ha: float | None = None
    burned_5yr_ha: float | None = None
    open_incidents: int = 0


def _entry(key: str, value, unit: str | None, status: str, target: float | None = None):
    return {"key": key, "value": value, "unit": unit, "status": status, "target": target}


def _pct(part: float | None, whole: float | None) -> float | None:
    if part is None or not whole:
        return None
    return round(part / whole * 100, 1)


def _achieved(x: ScoreInputs, lo: float, hi: float) -> dict:
    base = x.contracted_area_ha or x.parcel_area_ha
    pct = _pct(x.tc_latest, base)
    if pct is None:
        return _entry("achieved_pct", None, "%", "none", hi)
    status = "ok" if pct >= hi else "watch" if pct >= lo else "action"
    return _entry("achieved_pct", min(100.0, pct), "%", status, hi)


def _tc_trend(x: ScoreInputs) -> dict:
    if x.tc_latest is None or x.tc_prev is None:
        return _entry("tc_trend", None, "ha", "none")
    delta = round(x.tc_latest - x.tc_prev, 2)
    base = x.contracted_area_ha or x.parcel_area_ha or 0
    status = "ok" if delta >= 0 else ("action" if base and -delta > 0.1 * base else "watch")
    return _entry("tc_trend", delta, "ha", status)


def _fire_exclusion(x: ScoreInputs) -> dict:
    if x.burned_current_ha is None:
        return _entry("fire_exclusion", None, "ha", "none")
    avg = (x.burned_5yr_ha or 0) / 5
    if x.burned_current_ha == 0:
        status = "ok"
    elif avg > 0 and x.burned_current_ha < avg:
        status = "watch"
    else:
        status = "action"
    return _entry("fire_exclusion", round(x.burned_current_ha, 2), "ha", status)


def _no_clearing(x: ScoreInputs) -> dict:
    if x.defor_current_ha is None:
        return _entry("no_clearing", None, "ha", "none")
    v = round(x.defor_current_ha, 2)
    status = "ok" if v == 0 else "watch" if v < 0.1 else "action"
    return _entry("no_clearing", v, "ha", status)


def _disturbance(x: ScoreInputs) -> dict:
    """SFM: disturbance share of the parcel vs the ~9 % collateral-damage
    benchmark of well-run selective logging."""
    pct = _pct(x.defor_current_ha, x.parcel_area_ha)
    if pct is None:
        return _entry("disturbance_pct", None, "%", "none", 9.0)
    status = "ok" if pct < 4.5 else "watch" if pct < 9.0 else "action"
    return _entry("disturbance_pct", pct, "%", status, 9.0)


def _forest_share(x: ScoreInputs) -> dict:
    pct = _pct(x.tc_latest, x.parcel_area_ha)
    if pct is None:
        return _entry("forest_share", None, "%", "none")
    return _entry("forest_share", min(100.0, pct), "%", "ok" if pct >= 70 else "watch")


def _incidents(x: ScoreInputs) -> dict:
    status = "ok" if x.open_incidents == 0 else "action"
    return _entry("open_incidents", x.open_incidents, None, status)


def build_scorecard(group: str, x: ScoreInputs) -> list[dict]:
    """KPIs for one contract, most decision-relevant first."""
    if group == "agroforestry":
        rows = [_achieved(x, 30, 70), _tc_trend(x), _no_clearing(x)]
    elif group == "reforestation":
        rows = [_achieved(x, 30, 70), _tc_trend(x), _fire_exclusion(x)]
    elif group == "natural_regeneration":
        rows = [_fire_exclusion(x), _tc_trend(x), _achieved(x, 40, 70)]
    elif group == "deforestation_free_agriculture":
        rows = [_no_clearing(x), _fire_exclusion(x)]
    elif group == "forest_management":
        rows = [_disturbance(x), _fire_exclusion(x), _tc_trend(x)]
    elif group == "conservation":
        rows = [_forest_share(x), _no_clearing(x), _tc_trend(x)]
    else:
        rows = [_forest_share(x), _no_clearing(x), _fire_exclusion(x)]
    return [_incidents(x), *rows]


def overall_status(entries: list[dict]) -> str:
    """Worst measured status wins; all-unmeasured is 'none'."""
    order = {"action": 3, "watch": 2, "ok": 1}
    measured = [e["status"] for e in entries if e["status"] != "none"]
    if not measured:
        return "none"
    return max(measured, key=lambda s: order.get(s, 0))
