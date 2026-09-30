"""AOI analysis (design doc M3, v1: governance-context overlaps).

The caller draws a polygon; the answer is what governs that land — every
governance feature it intersects, per layer, with overlap hectares and
share of the AOI. Computed in PostGIS against the trigger-maintained
gov_areas.geom column (005_spatial.sql). Remote-sensing indicators for
AOIs (tree cover, loss, alerts) are the documented next step once GEE
credentials reach the API runtime.
"""

import json

from fastapi import APIRouter, Body, Depends, HTTPException

from .auth import CurrentUser, Principal
from .db import get_conn
from .governance import GOV_LAYERS, _PRODUCTION_FILTER
from .schemas import AoiOverlap, AoiResult

router = APIRouter()

MAX_AOI_HA = 5_000_000  # sanity bound: ~a large province


_AOI_SQL = f"""
WITH aoi AS (
  SELECT ST_SetSRID(ST_GeomFromGeoJSON(%(geometry)s), 4326) AS g
)
SELECT a.layer, a.src_uid, a.name, a.reference, a.iso3, a.doc_count,
       ST_Area(ST_Intersection(a.geom, aoi.g)::geography) / 10000.0 AS overlap_ha
FROM gov_areas a, aoi
WHERE a.geom IS NOT NULL
  AND {_PRODUCTION_FILTER.replace("retired", "a.retired").replace("situation", "a.situation")}
  AND ST_Intersects(a.geom, aoi.g)
ORDER BY overlap_ha DESC
LIMIT 500
"""


@router.post("/api/aoi", response_model=AoiResult)
def analyze_aoi(
    geometry: dict = Body(..., embed=True, description="GeoJSON Polygon/MultiPolygon (WGS84)"),
    conn=Depends(get_conn),
    user: Principal = CurrentUser,
) -> AoiResult:
    if geometry.get("type") not in ("Polygon", "MultiPolygon"):
        raise HTTPException(status_code=422, detail="geometry must be a Polygon or MultiPolygon")
    gj = json.dumps(geometry)
    try:
        area_ha = conn.execute(
            "SELECT ST_Area(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)::geography) / 10000.0",
            (gj,),
        ).fetchone()[0]
    except Exception as exc:
        conn.rollback()
        raise HTTPException(status_code=422, detail=f"invalid geometry: {exc}") from exc
    if area_ha is None or area_ha <= 0:
        raise HTTPException(status_code=422, detail="empty geometry")
    if area_ha > MAX_AOI_HA:
        raise HTTPException(status_code=422, detail=f"AOI larger than {MAX_AOI_HA} ha")

    rows = conn.execute(_AOI_SQL, {"geometry": gj}).fetchall()
    overlaps = [
        AoiOverlap(
            layer=r[0],
            src_uid=r[1],
            name=r[2],
            reference=r[3],
            iso3=r[4],
            doc_count=r[5],
            overlap_ha=round(r[6], 2),
            overlap_pct=round(min(100.0, r[6] / area_ha * 100.0), 1),
        )
        for r in rows
        if r[6] and r[6] >= 0.01
    ]
    by_layer = {
        layer: round(sum(o.overlap_ha for o in overlaps if o.layer == layer), 2)
        for layer in GOV_LAYERS
        if any(o.layer == layer for o in overlaps)
    }
    return AoiResult(area_ha=round(area_ha, 2), overlaps=overlaps, by_layer=by_layer)
