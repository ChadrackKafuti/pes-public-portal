"""Application profile (M7b) — the v1 popup content, server-assembled.

Everything v1's ArcGIS popups showed comes back from three places:
the raw PES payload mirror (pes_raw_records), our computed RS rows
(pes_rs_objects), and the parcel cache. Field names are resolved
case-insensitively against candidate lists (the live payload spelling
rules the mapping, as in pes_api.FIELD_CANDIDATES); every section is
optional — the frontend renders what exists.
"""

import json
import re
from datetime import UTC, date, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from .auth import CurrentUser, Principal
from .db import get_conn
from .schemas import (
    ProfileAreas,
    ProfileBeneficiary,
    ProfileContract,
    ProfileFire,
    ProfileOut,
    ProfilePerformance,
    ProfileProject,
    ProfileSpecies,
    ProfileStage,
    ProfileVisits,
)

router = APIRouter()

STAGE_TOTAL = 7  # v1: "Pre-application" … "Approved"


def _pick(payload: dict, names: list[str]) -> Any:
    lowered = {str(k).lower(): v for k, v in payload.items()}
    for n in names:
        v = lowered.get(n)
        if v not in (None, "", "null", "None"):
            return v
    return None


def _num(v: Any) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _int(v: Any) -> int | None:
    f = _num(v)
    return int(f) if f is not None else None


def _date(v: Any) -> date | None:
    if v in (None, "", "null"):
        return None
    if isinstance(v, (int, float)):  # epoch millis
        return datetime.fromtimestamp(v / 1000, tz=UTC).date()
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00")).date()
    except ValueError:
        m = re.match(r"(\d{4})[-/](\d{2})[-/](\d{2})", str(v))
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else None


def _activity_group(activity: str | None) -> str:
    a = (activity or "").lower()
    if "agrofor" in a:
        return "agroforestry"
    if "refor" in a or "planta" in a:
        return "reforestation"
    if "regen" in a or "savan" in a:
        return "natural_regeneration"
    return "generic"


def _stage(payload: dict) -> ProfileStage | None:
    name = _pick(payload, ["stage", "applicationstage", "stagename"])
    order = _int(_pick(payload, ["stageorder", "stageno", "stagenumber"]))
    status = _pick(payload, ["applicationstatus", "status"])
    if name is None and order is None and status is None:
        return None
    text = str(name or status or "")
    low = text.lower()
    if "reject" in low or (order is not None and order < 0):
        category = "rejected"
    elif "archiv" in low:
        category = "archived"
    elif order is not None or name is not None:
        category = "active"
    else:
        category = "unknown"
    return ProfileStage(
        name=str(name) if name is not None else None,
        order=abs(order) if order is not None else None,
        total=STAGE_TOTAL,
        category=category,
        status=str(status) if status is not None else None,
    )


def _species(payload: dict) -> list[ProfileSpecies]:
    raw = _pick(payload, ["treedensity", "plannedspecies", "treespecies"])
    if raw is None:
        return []
    data = raw
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except (json.JSONDecodeError, ValueError):
            return [ProfileSpecies(name=data[:120], density_per_ha=None)]
    out: list[ProfileSpecies] = []
    if isinstance(data, dict):
        data = [data]
    if isinstance(data, list):
        for item in data[:20]:
            if isinstance(item, dict):
                name = _pick(item, ["name", "species", "speciesname", "treespecies"])
                dens = _num(_pick(item, ["density", "densityperha", "treedensity"]))
                if name is not None or dens is not None:
                    out.append(ProfileSpecies(name=str(name) if name else None, density_per_ha=dens))
            elif isinstance(item, str):
                out.append(ProfileSpecies(name=item[:120], density_per_ha=None))
    return out


def _fire_category(burned_pct: float | None) -> str | None:
    """Approximation of v1's fireriskcategory (which used 5-yr burn counts):
    classified from the burned share of the parcel over 5 years."""
    if burned_pct is None:
        return None
    if burned_pct <= 0:
        return "low"
    if burned_pct < 10:
        return "moderate"
    if burned_pct < 30:
        return "high"
    return "very_high"


@router.get("/api/applications/{application_id}/profile", response_model=ProfileOut)
def application_profile(
    application_id: str,
    conn=Depends(get_conn),
    user: Principal = CurrentUser,
) -> ProfileOut:
    raw_row = conn.execute(
        "SELECT payload, synced_utc FROM pes_raw_records WHERE kind = 'application' AND record_id = %s",
        (application_id,),
    ).fetchone()
    parcel = conn.execute(
        """
        SELECT application_code, contract_code, application_date, pes_activity,
               country, province, territory, village, implementing_org, project_name,
               estimated_area_ha
        FROM pes_parcels WHERE application_id = %s
        """,
        (application_id,),
    ).fetchone()
    if raw_row is None and parcel is None:
        raise HTTPException(status_code=404, detail="unknown application")
    payload: dict = raw_row[0] if raw_row else {}
    synced = raw_row[1] if raw_row else None

    rs = conn.execute(
        """
        SELECT object_type, object_date, parcel_area_ha, burned_area_5yr_ha,
               fire_alerts_5yr, geom_source, processed_utc
        FROM pes_rs_objects WHERE application_id = %s ORDER BY object_date
        """,
        (application_id,),
    ).fetchall()
    app_rs = next((r for r in rs if r[0] == "application"), None)
    latest_rs = rs[-1] if rs else None

    # Visits: raw visit payloads linked by application reference (322→ small
    # table today; expression-index when it grows).
    visit_payloads = [
        r[0]
        for r in conn.execute(
            "SELECT payload FROM pes_raw_records WHERE kind = 'monitoring_visit'"
        ).fetchall()
        if str(
            _pick(r[0], ["applicationid", "parentrecordid", "contractapplicationid", "applicationcode"])
        )
        == application_id
    ]
    today = date.today()
    visit_dates = sorted(
        d
        for d in (
            _date(_pick(v, ["monitoringdate", "visitdate", "date"])) for v in visit_payloads
        )
        if d is not None
    )
    done = [d for d in visit_dates if d <= today]
    future = [d for d in visit_dates if d > today]
    declared_expected = _int(_pick(payload, ["visitcount", "expectedvisits", "numberofvisits"]))
    overdue_flag = _pick(payload, ["monitoringoverdue"])
    visits = (
        ProfileVisits(
            expected=declared_expected if declared_expected is not None else len(visit_dates) or None,
            completed=len(done),
            last_date=done[-1] if done else None,
            next_due=future[0] if future else None,
            overdue=bool(_int(overdue_flag)) if overdue_flag is not None else None,
        )
        if visit_dates or declared_expected is not None
        else None
    )

    # Contract block (raw fields; v1 looked these up on the contracts layer).
    c_start = _date(_pick(payload, ["contractstartdate", "startdate"]))
    c_end = _date(_pick(payload, ["contractenddate", "enddate"]))
    pct_elapsed = days_remaining = None
    if c_start and c_end and c_end > c_start:
        total_days = (c_end - c_start).days
        pct_elapsed = round(min(100.0, max(0.0, (today - c_start).days / total_days * 100)), 1)
        days_remaining = max(0, (c_end - today).days)
    contract_code = _pick(payload, ["contractcode"]) or (parcel[1] if parcel else None)
    contract = (
        ProfileContract(
            code=str(contract_code) if contract_code else None,
            status=_pick(payload, ["contractstatus"]),
            start=c_start,
            end=c_end,
            duration_years=_num(_pick(payload, ["contractdurationyears", "durationyears"])),
            declared_area_ha=_num(_pick(payload, ["areadeclaredbyplanter", "declaredarea"])),
            contracted_area_ha=_num(_pick(payload, ["contractedpesarea", "contractedarea"])),
            pct_elapsed=pct_elapsed,
            days_remaining=days_remaining,
            species=_species(payload),
        )
        if contract_code or c_start or _pick(payload, ["contractstatus"])
        else None
    )

    # Fire card from OUR RS figures (v1 wording, our data).
    parcel_area = latest_rs[2] if latest_rs else None
    burned5 = latest_rs[3] if latest_rs else None
    burned_pct = (
        round(burned5 / parcel_area * 100, 1)
        if burned5 is not None and parcel_area
        else (0.0 if burned5 == 0 else None)
    )
    fire = (
        ProfileFire(
            burned_5yr_ha=burned5,
            burned_pct=burned_pct,
            fire_alerts_5yr=latest_rs[4] if latest_rs else None,
            category=_fire_category(burned_pct),
        )
        if latest_rs is not None
        else None
    )

    # Activity performance: the latest COMPLETED visit's measured areas.
    dated = sorted(
        (
            (v, _date(_pick(v, ["monitoringdate", "visitdate", "date"])))
            for v in visit_payloads
        ),
        key=lambda t: t[1] or date.min,
    )
    past = [v for v, d in dated if d is not None and d <= today]
    latest_visit_payload = past[-1] if past else (dated[-1][0] if dated else None)
    perf = None
    if latest_visit_payload is not None:
        planted = _num(_pick(latest_visit_payload, ["plantedareameasured", "achievedarea", "plantedarea"]))
        gap = _num(_pick(latest_visit_payload, ["unplantedarea", "gaparea", "remainingarea"]))
        trees = _int(_pick(latest_visit_payload, ["observedtreescount", "treescount"]))
        cover = _pick(latest_visit_payload, ["observedlandcover", "landcoverobserved"])
        cover_pct = _num(_pick(latest_visit_payload, ["observedlandcoverpct", "landcoverpct"]))
        if any(v is not None for v in (planted, gap, trees, cover)):
            total = (planted or 0) + (gap or 0)
            perf = ProfilePerformance(
                achieved_ha=planted,
                gap_ha=gap,
                achieved_pct=round(planted / total * 100, 1) if planted is not None and total else None,
                monitored_total_ha=total or None,
                observed_trees=trees,
                observed_land_cover=str(cover) if cover is not None else None,
                observed_land_cover_pct=cover_pct,
            )

    activity = (parcel[3] if parcel else None) or _pick(payload, ["activitytype", "pesactivity"])
    estimated = (parcel[10] if parcel else None) or _num(_pick(payload, ["estimatedarea"]))
    areas = ProfileAreas(
        estimated_ha=estimated,
        declared_ha=contract.declared_area_ha if contract else None,
        contracted_ha=contract.contracted_area_ha if contract else None,
        achieved_ha=perf.achieved_ha if perf else None,
    )

    beneficiary = ProfileBeneficiary(
        type=_pick(payload, ["beneficiarytype"]),
        status=_pick(payload, ["beneficiarystatus"]),
        gender=_pick(payload, ["beneficiarygender", "gender"]),
        family_situation=_pick(payload, ["familysituation"]),
        dependents=_int(_pick(payload, ["dependents", "numberofdependents"])),
        community_members=_int(_pick(payload, ["communitymembers", "numberofcommunitymembers"])),
    )
    if all(
        getattr(beneficiary, f) is None
        for f in ("type", "status", "gender", "family_situation", "dependents", "community_members")
    ):
        beneficiary = None

    aggregator = _pick(payload, ["supportingaggregator"])
    if isinstance(aggregator, (dict, list)):
        try:
            agg = aggregator[0] if isinstance(aggregator, list) and aggregator else aggregator
            if isinstance(agg, dict):
                name = _pick(agg, ["entityfullname", "name"])
                acro = _pick(agg, ["entityacronym", "acronym"])
                aggregator = f"{name} ({acro})" if name and acro else (name or acro)
        except (KeyError, IndexError, TypeError):
            aggregator = None
    project = ProfileProject(
        name=(parcel[9] if parcel else None) or _pick(payload, ["projectname"]),
        org=(parcel[8] if parcel else None) or _pick(payload, ["implementingorgname"]),
        org_acronym=_pick(payload, ["implementingorgacronym", "orgacronym"]),
        aggregator=str(aggregator) if aggregator else None,
    )

    return ProfileOut(
        application_id=application_id,
        application_code=(parcel[0] if parcel else None) or _pick(payload, ["applicationcode"]),
        application_date=(parcel[2] if parcel else None)
        or _date(_pick(payload, ["applicationdate", "enrolmentdate"])),
        activity=str(activity) if activity else None,
        activity_group=_activity_group(str(activity) if activity else None),
        stage=_stage(payload),
        location={
            "country": (parcel[4] if parcel else None) or _pick(payload, ["country"]),
            "province": (parcel[5] if parcel else None) or _pick(payload, ["province"]),
            "territory": (parcel[6] if parcel else None) or _pick(payload, ["territory"]),
            "village": (parcel[7] if parcel else None) or _pick(payload, ["village"]),
        },
        beneficiary=beneficiary,
        project=project,
        contract=contract,
        visits=visits,
        fire=fire,
        performance=perf,
        areas=areas,
        geometry_source=latest_rs[5] if latest_rs else None,
        last_sync=synced,
    )
