"""Contract analyses (M7d) — the v1 contract-analysis page's data.

Pickers come from the parcel cache (Org → Project → Contract); the series
is the pipeline's annual Dynamic World table summed over the contract's
applications; description fields fall back to the raw payload mirror.
"""

from fastapi import APIRouter, Depends, HTTPException

from .auth import CurrentUser, Principal
from .contracts import contract_code_visibility, visit_contract_links
from .db import get_conn
from .profile import _date, _num, _pick
from .schemas import AnalysesContract, AnnualPoint, ContractAnalysis, NdviPoint

router = APIRouter()


def _parcels_by_contract(conn) -> dict[str, list[tuple]]:
    """pes_parcels rows grouped by their effective contract code: the parcel
    column where filled, else the visit-derived link (production applications
    carry no ContractCode of their own)."""
    from .visibility import hidden_application_ids

    links = visit_contract_links(conn)
    hidden = hidden_application_ids(conn)
    rows = conn.execute(
        """
        SELECT application_id, contract_code, implementing_org, project_name,
               country, village, pes_activity, estimated_area_ha, application_date,
               application_code
        FROM pes_parcels
        """
    ).fetchall()
    groups: dict[str, list[tuple]] = {}
    for r in rows:
        if str(r[0]) in hidden:  # archived/deleted applications (M14)
            continue
        code = r[1] or links.get(str(r[0]))
        if code:
            groups.setdefault(str(code), []).append(r)
    # Archived/deleted contracts: a code seen on visits but with no live
    # selected visit is retired and leaves the pickers too (M14).
    live, seen = contract_code_visibility(conn)
    return {c: g for c, g in groups.items() if c in live or c not in seen}


@router.get("/api/analyses/contracts", response_model=list[AnalysesContract])
def analyses_contracts(
    conn=Depends(get_conn), user: Principal = CurrentUser
) -> list[AnalysesContract]:
    # Which applications already carry an annual series — the picker flags
    # those contracts as ready to review while the backlog drains (M21).
    ready = {
        str(r[0])
        for r in conn.execute(
            "SELECT DISTINCT application_id FROM pes_annual_indicators"
        ).fetchall()
    }
    out = []
    for code, g in sorted(_parcels_by_contract(conn).items()):
        def mx(i: int):
            return max((r[i] for r in g if r[i] is not None), default=None)

        areas = [r[7] for r in g if r[7] is not None]
        out.append(
            AnalysesContract(
                contract_code=code, application_code=mx(9), org=mx(2),
                project=mx(3), country=mx(4),
                village=mx(5), activity=mx(6), applications=len(g),
                estimated_area_ha=sum(areas) if areas else None,
                first_date=min((r[8] for r in g if r[8] is not None), default=None),
                has_series=any(str(r[0]) in ready for r in g),
            )
        )
    return out


@router.get(
    "/api/analyses/contracts/{contract_code}/ndvi", response_model=list[NdviPoint]
)
def contract_ndvi(
    contract_code: str, conn=Depends(get_conn), user: Principal = CurrentUser
) -> list[NdviPoint]:
    """M29b — the contract's monthly NDVI phenology with its control."""
    apps = [str(r[0]) for r in _parcels_by_contract(conn).get(contract_code, [])]
    if not apps:
        raise HTTPException(status_code=404, detail="unknown contract")
    rows = conn.execute(
        """
        SELECT month, avg(ndvi), avg(control_ndvi)
        FROM pes_ndvi_monthly
        WHERE application_id = ANY(%s)
        GROUP BY month ORDER BY month
        """,
        (apps,),
    ).fetchall()
    return [
        NdviPoint(
            month=r[0],
            ndvi=round(r[1], 4) if r[1] is not None else None,
            control_ndvi=round(r[2], 4) if r[2] is not None else None,
        )
        for r in rows
    ]


@router.get("/api/analyses/contracts/{contract_code}", response_model=ContractAnalysis)
def contract_analysis(
    contract_code: str, conn=Depends(get_conn), user: Principal = CurrentUser
) -> ContractAnalysis:
    apps = [str(r[0]) for r in _parcels_by_contract(conn).get(contract_code, [])]
    if not apps:
        raise HTTPException(status_code=404, detail="unknown contract")

    series = conn.execute(
        """
        SELECT year, sum(tc_ha), sum(loss_ha), sum(control_tc_ha),
               sum(burned_ha), sum(patch_count), avg(edge_m_per_ha)
        FROM pes_annual_indicators
        WHERE application_id = ANY(%s)
        GROUP BY year ORDER BY year
        """,
        (apps,),
    ).fetchall()

    meta = conn.execute(
        """
        SELECT max(p.implementing_org), max(p.project_name), max(p.country),
               max(p.village), max(p.pes_activity), sum(o.parcel_area_ha),
               sum(o.parcel_area_ha * o.canopy_pct_gt3m)
                 / nullif(sum(o.parcel_area_ha)
                          FILTER (WHERE o.canopy_pct_gt3m IS NOT NULL), 0),
               sum(o.parcel_area_ha * o.canopy_mean_m)
                 / nullif(sum(o.parcel_area_ha)
                          FILTER (WHERE o.canopy_mean_m IS NOT NULL), 0)
        FROM pes_parcels p
        LEFT JOIN pes_rs_objects o
          ON o.object_id = p.application_id AND o.object_type = 'application'
        WHERE p.application_id = ANY(%s)
        """,
        (apps,),
    ).fetchone()

    # Description fields: the application payload where sources carry the
    # contract block there, else this contract's visit payloads (production
    # puts ContractStatus/dates/ContractedPESArea on monitoring visits).
    raw = conn.execute(
        """
        SELECT payload FROM pes_raw_records
        WHERE kind = 'application' AND record_id = ANY(%s)
        LIMIT 1
        """,
        (apps,),
    ).fetchone()
    payloads = [raw[0]] if raw else []
    from .visibility import visit_hidden

    payloads += [
        p
        for (p,) in conn.execute(
            "SELECT payload FROM pes_raw_records WHERE kind = 'monitoring_visit'"
        ).fetchall()
        if str(_pick(p, ["contractcode"]) or "").strip() == contract_code
        and not visit_hidden(p)
    ]

    def pick_any(keys: list[str]):
        for p in payloads:
            v = _pick(p, keys)
            if v is not None:
                return v
        return None

    # M24 — activity scorecard inputs: contract-summed RS indicators,
    # the annual series' last two points, and open incidents.
    from .profile import _activity_group
    from .scorecard import ScoreInputs, build_scorecard, overall_status

    rs = conn.execute(
        """
        SELECT sum(defor_current_ha), sum(burned_area_current_ha),
               sum(burned_area_5yr_ha), sum(fire_alerts_current),
               sum(defor_alerts_current)
        FROM pes_rs_objects
        WHERE object_type = 'application' AND object_id = ANY(%s)
        """,
        (apps,),
    ).fetchone()
    open_inc = conn.execute(
        """
        SELECT count(*) FROM pes_incidents
        WHERE application_id = ANY(%s) AND status IN ('open', 'responded')
        """,
        (apps,),
    ).fetchone()[0]
    contracted = _num(pick_any(["contractedpesarea", "contractedarea"]))
    tc_points = [r for r in series if r[1] is not None]
    group = _activity_group(meta[4])
    inputs = ScoreInputs(
        parcel_area_ha=meta[5],
        contracted_area_ha=contracted,
        tc_latest=tc_points[-1][1] if tc_points else None,
        tc_prev=tc_points[-2][1] if len(tc_points) > 1 else None,
        latest_year=tc_points[-1][0] if tc_points else None,
        defor_current_ha=rs[0],
        burned_current_ha=rs[1],
        burned_5yr_ha=rs[2],
        fire_alerts_current=rs[3],
        defor_alerts_current=rs[4],
        open_incidents=int(open_inc),
    )
    entries = build_scorecard(group, inputs)

    # M28 — planting-event confirmation for the planting activities.
    if group in ("reforestation", "agroforestry"):
        from .scorecard import planting_event

        start = _date(pick_any(["contractstartdate", "startdate"]))
        entries.append(
            planting_event(
                [(r[0], r[1]) for r in series],
                start.year if start else None,
                contracted or meta[5],
            )
        )

    return ContractAnalysis(
        contract_code=contract_code,
        org=meta[0],
        project=meta[1],
        country=meta[2],
        village=meta[3],
        activity=meta[4],
        applications=len(apps),
        parcel_area_ha=meta[5],
        contracted_area_ha=_num(pick_any(["contractedpesarea", "contractedarea"])),
        beneficiary_type=pick_any(["beneficiarytype"]),
        start_date=_date(pick_any(["contractstartdate", "startdate"])),
        end_date=_date(pick_any(["contractenddate", "enddate"])),
        series=[
            AnnualPoint(
                year=r[0], tc_ha=r[1], loss_ha=r[2], control_tc_ha=r[3],
                burned_ha=r[4], patch_count=r[5],
                edge_m_per_ha=round(r[6], 1) if r[6] is not None else None,
            )
            for r in series
        ],
        canopy_pct_gt3m=round(meta[6], 1) if meta[6] is not None else None,
        canopy_mean_m=round(meta[7], 2) if meta[7] is not None else None,
        activity_group=group,
        scorecard=entries,
        overall_status=overall_status(entries),
    )
