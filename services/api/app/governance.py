"""Forest-governance layer routes (gov_* tables fed by services/governance).

Serves the seven Congo Basin governance layers as GeoJSON plus the public
documents table — the portal-v1 ArcGIS FeatureLayers' replacement. The
default view applies the ingest's production filter
(retired = 0 AND situation IN ('complete','part_complete')).
"""

import json

from fastapi import APIRouter, Depends, HTTPException, Query

from .auth import CurrentUser, Principal
from .db import get_conn
from .schemas import GovDocumentOut, GovLayerInfo, to_camel

router = APIRouter()

GOV_LAYERS = [
    "protected_areas", "concessions", "concession_zoning", "community_forests",
    "community_forest_zoning", "local_territories", "local_territory_zoning",
]

_PRODUCTION_FILTER = "retired = 0 AND situation IN ('complete', 'part_complete')"

# Columns exposed as GeoJSON feature properties (extras jsonb is merged on top).
_PROP_COLUMNS = [
    "src_uid", "layer", "iso3", "country", "province", "admin2",
    "name", "reference", "holder", "operator", "community",
    "sub_type_std", "sub_type_raw", "status_std", "status_mgmt_std",
    "situation", "area_calc_ha", "area_adm_ha", "date_attr", "year_ref",
    "doc_count", "parent_uid", "src_vintage", "src_layer",
]


@router.get("/api/governance/layers", response_model=list[GovLayerInfo])
def governance_layers(
    conn=Depends(get_conn), user: Principal = CurrentUser
) -> list[GovLayerInfo]:
    """Layer registry with per-country production-filtered counts — drives the
    map layer panel."""
    rows = conn.execute(
        f"""
        SELECT layer, iso3, count(*), max(loaded_at)
        FROM gov_areas WHERE {_PRODUCTION_FILTER}
        GROUP BY layer, iso3
        """
    ).fetchall()
    by_layer: dict[str, dict] = {}
    for layer, iso3, n, loaded in rows:
        entry = by_layer.setdefault(layer, {"total": 0, "by_country": {}, "last": None})
        entry["total"] += n
        entry["by_country"][iso3 or "?"] = n
        if loaded and (entry["last"] is None or loaded > entry["last"]):
            entry["last"] = loaded
    return [
        GovLayerInfo(
            layer=layer,
            total=by_layer.get(layer, {}).get("total", 0),
            by_country=by_layer.get(layer, {}).get("by_country", {}),
            last_loaded_utc=by_layer.get(layer, {}).get("last"),
        )
        for layer in GOV_LAYERS
    ]


@router.get("/api/governance/{layer}.geojson")
def governance_geojson(
    layer: str,
    country: str | None = Query(None, description="iso3 filter, e.g. COD"),
    include_all: bool = Query(False, alias="all", description="true bypasses the production filter"),
    detail: str = Query("display", description="'display' (simplified, default) or 'full'"),
    conn=Depends(get_conn),
    user: Principal = CurrentUser,
) -> dict:
    if layer not in GOV_LAYERS:
        raise HTTPException(status_code=404, detail="unknown governance layer")
    # Simplified display geometry by default (the COD zoning layer is 41k
    # polygons); rows ingested before the geom_display column fall back to
    # the full geometry.
    geom_col = "geom_geojson" if detail == "full" else "coalesce(geom_display, geom_geojson)"
    where = ["layer = %(layer)s", "geom_geojson IS NOT NULL"]
    if not include_all:
        where.append(_PRODUCTION_FILTER)
    if country:
        where.append("iso3 = %(country)s")
    rows = conn.execute(
        f"""
        SELECT {", ".join(_PROP_COLUMNS)}, extras, {geom_col}
        FROM gov_areas WHERE {" AND ".join(where)}
        """,
        {"layer": layer, "country": (country or "").upper() or None},
    ).fetchall()
    features = []
    for r in rows:
        props = {}
        for i, col in enumerate(_PROP_COLUMNS):
            v = r[i]
            if v is None:
                continue
            if col == "date_attr":
                v = v.date().isoformat()
            props[to_camel(col)] = v
        extras = r[len(_PROP_COLUMNS)] or {}
        for k, v in extras.items():
            if v is not None:
                props.setdefault(to_camel(k), v)
        geometry = r[len(_PROP_COLUMNS) + 1]
        if isinstance(geometry, str):  # jsonb normally decodes; be tolerant
            geometry = json.loads(geometry)
        features.append({"type": "Feature", "geometry": geometry, "properties": props})
    return {"type": "FeatureCollection", "features": features}


@router.get(
    "/api/governance/features/{src_uid}/documents",
    response_model=list[GovDocumentOut],
)
def governance_documents(
    src_uid: str, conn=Depends(get_conn), user: Principal = CurrentUser
) -> list[GovDocumentOut]:
    """The feature's public documents (portal-v1 popup document list)."""
    rows = conn.execute(
        """
        SELECT doc_uid, title, category_std, file_name, content_type,
               size_bytes, date_doc, url, src_system
        FROM gov_documents
        WHERE parent_uid = %s AND retired = 0
        ORDER BY category_std, title
        """,
        (src_uid,),
    ).fetchall()
    if not rows:
        known = conn.execute(
            "SELECT 1 FROM gov_areas WHERE src_uid = %s", (src_uid,)
        ).fetchone()
        if known is None:
            raise HTTPException(status_code=404, detail="unknown feature")
    fields = ["doc_uid", "title", "category_std", "file_name", "content_type",
              "size_bytes", "date_doc", "url", "src_system"]
    return [GovDocumentOut(**dict(zip(fields, r, strict=True))) for r in rows]
