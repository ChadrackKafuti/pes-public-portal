"""Contract analyses (M7d) — the v1 contract-analysis page's data.

Pickers come from the parcel cache (Org → Project → Contract); the series
is the pipeline's annual Dynamic World table summed over the contract's
applications; description fields fall back to the raw payload mirror.
"""

from fastapi import APIRouter, Depends, HTTPException

from .auth import CurrentUser, Principal
from .db import get_conn
from .profile import _date, _num, _pick
from .schemas import AnalysesContract, AnnualPoint, ContractAnalysis

router = APIRouter()


@router.get("/api/analyses/contracts", response_model=list[AnalysesContract])
def analyses_contracts(
    conn=Depends(get_conn), user: Principal = CurrentUser
) -> list[AnalysesContract]:
    rows = conn.execute(
        """
        SELECT contract_code, max(implementing_org), max(project_name),
               max(country), max(village), max(pes_activity),
               count(*), sum(estimated_area_ha), min(application_date)
        FROM pes_parcels
        WHERE contract_code IS NOT NULL
        GROUP BY contract_code
        ORDER BY contract_code
        """
    ).fetchall()
    return [
        AnalysesContract(
            contract_code=r[0], org=r[1], project=r[2], country=r[3],
            village=r[4], activity=r[5], applications=r[6],
            estimated_area_ha=r[7], first_date=r[8],
        )
        for r in rows
    ]


@router.get("/api/analyses/contracts/{contract_code}", response_model=ContractAnalysis)
def contract_analysis(
    contract_code: str, conn=Depends(get_conn), user: Principal = CurrentUser
) -> ContractAnalysis:
    apps = [
        r[0]
        for r in conn.execute(
            "SELECT application_id FROM pes_parcels WHERE contract_code = %s",
            (contract_code,),
        ).fetchall()
    ]
    if not apps:
        raise HTTPException(status_code=404, detail="unknown contract")

    series = conn.execute(
        """
        SELECT year, sum(tc_ha), sum(loss_ha)
        FROM pes_annual_indicators
        WHERE application_id = ANY(%s)
        GROUP BY year ORDER BY year
        """,
        (apps,),
    ).fetchall()

    meta = conn.execute(
        """
        SELECT max(p.implementing_org), max(p.project_name), max(p.country),
               max(p.village), max(p.pes_activity), sum(o.parcel_area_ha)
        FROM pes_parcels p
        LEFT JOIN pes_rs_objects o
          ON o.object_id = p.application_id AND o.object_type = 'application'
        WHERE p.contract_code = %s
        """,
        (contract_code,),
    ).fetchone()

    raw = conn.execute(
        """
        SELECT payload FROM pes_raw_records
        WHERE kind = 'application' AND record_id = ANY(%s)
        LIMIT 1
        """,
        (apps,),
    ).fetchone()
    payload = raw[0] if raw else {}

    return ContractAnalysis(
        contract_code=contract_code,
        org=meta[0],
        project=meta[1],
        country=meta[2],
        village=meta[3],
        activity=meta[4],
        applications=len(apps),
        parcel_area_ha=meta[5],
        contracted_area_ha=_num(_pick(payload, ["contractedpesarea", "contractedarea"])),
        beneficiary_type=_pick(payload, ["beneficiarytype"]),
        start_date=_date(_pick(payload, ["contractstartdate", "startdate"])),
        end_date=_date(_pick(payload, ["contractenddate", "enddate"])),
        series=[AnnualPoint(year=r[0], tc_ha=r[1], loss_ha=r[2]) for r in series],
    )
