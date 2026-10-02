"""Geotagged photos (M7a) — the v1 photo layers as API endpoints.

Points come from pes_photos (synced by the pipeline). The images live in a
private Supabase Storage bucket; the browser gets a short-lived signed URL
from /image-url, so the service key never leaves the server.
"""

import httpx
from fastapi import APIRouter, Depends, HTTPException

from .auth import CurrentUser, Principal
from .db import get_conn
from .schemas import PhotoOut
from .settings import settings

router = APIRouter()

_LIST_SQL = """
SELECT photo_uid, kind, parent_id, application_id, application_code,
       contract_code, photo_index, label, lon, lat,
       COALESCE(mirror_status = 'done', false) AS mirrored
FROM pes_photos
WHERE (%(application)s::text IS NULL
       OR application_id = %(application)s OR parent_id = %(application)s)
  AND (%(kind)s::text IS NULL OR kind = %(kind)s)
ORDER BY application_id, kind, photo_index
LIMIT %(limit)s
"""


def _rows(conn, application: str | None, kind: str | None, limit: int):
    return conn.execute(
        _LIST_SQL, {"application": application, "kind": kind, "limit": limit}
    ).fetchall()


def _app_locations(conn, app_ids: set[str]) -> dict[str, tuple[float, float]]:
    """Fallback coordinates for photos without GPS: the application's point,
    else its polygon centroid. Many source photos carry no EXIF position but
    still belong on the map at their parcel."""
    if not app_ids:
        return {}
    from .geo import shape_to_geometry

    out: dict[str, tuple[float, float]] = {}
    rows = conn.execute(
        "SELECT application_id, point_lon, point_lat, shape_raw "
        "FROM pes_parcels WHERE application_id = ANY(%s)",
        (list(app_ids),),
    ).fetchall()
    for aid, lon, lat, shape in rows:
        if lon is not None and lat is not None:
            out[aid] = (lon, lat)
            continue
        geom = shape_to_geometry(shape, None, None)
        if geom is not None:
            try:
                from shapely.geometry import shape as to_shape

                c = to_shape(geom).centroid
                out[aid] = (c.x, c.y)
            except Exception:  # noqa: BLE001 — bad shape: photo stays unplaced
                pass
    return out


@router.get("/api/photos.geojson")
def photos_geojson(
    application: str | None = None,
    kind: str | None = None,
    conn=Depends(get_conn),
    user: Principal = CurrentUser,
) -> dict:
    rows = _rows(conn, application, kind, 10000)

    # Source arrays report lon/lat 0 when the photo has no GPS; (0,0) is in
    # the Atlantic, never a Congo Basin parcel, so it counts as missing too.
    def gps(r) -> tuple[float, float] | None:
        if r[8] is None or r[9] is None or (r[8] == 0 and r[9] == 0):
            return None
        return (r[8], r[9])

    fallback = _app_locations(conn, {r[3] for r in rows if gps(r) is None and r[3]})
    features = []
    for r in rows:
        coords = gps(r) or fallback.get(r[3])
        if coords is None:
            continue  # no GPS and no locatable parcel
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [coords[0], coords[1]]},
                "properties": {
                    "photoUid": r[0],
                    "kind": r[1],
                    "parentId": r[2],
                    "applicationId": r[3],
                    "applicationCode": r[4],
                    "contractCode": r[5],
                    "photoIndex": r[6],
                    "label": r[7],
                    "mirrored": r[10],
                },
            }
        )
    return {"type": "FeatureCollection", "features": features}


@router.get("/api/applications/{application_id}/photos", response_model=list[PhotoOut])
def application_photos(
    application_id: str,
    conn=Depends(get_conn),
    user: Principal = CurrentUser,
) -> list[PhotoOut]:
    rows = _rows(conn, application_id, None, 500)
    return [
        PhotoOut(
            photo_uid=r[0], kind=r[1], parent_id=r[2], application_id=r[3],
            application_code=r[4], contract_code=r[5], photo_index=r[6],
            label=r[7], lon=r[8], lat=r[9], mirrored=r[10],
        )
        for r in rows
    ]


@router.get("/api/photos/{photo_uid}/image-url")
def photo_image_url(
    photo_uid: str,
    conn=Depends(get_conn),
    user: Principal = CurrentUser,
) -> dict:
    """A short-lived signed URL for the mirrored image (1 hour)."""
    row = conn.execute(
        "SELECT mirrored_path FROM pes_photos WHERE photo_uid = %s AND mirror_status = 'done'",
        (photo_uid,),
    ).fetchone()
    if row is None or not row[0]:
        raise HTTPException(status_code=404, detail="photo not mirrored")
    if not (settings.supabase_url and settings.supabase_service_key):
        raise HTTPException(status_code=503, detail="photo storage not configured")
    path = row[0]
    try:
        r = httpx.post(
            f"{settings.supabase_url}/storage/v1/object/sign/{settings.photos_bucket}/{path}",
            headers={"Authorization": f"Bearer {settings.supabase_service_key}"},
            json={"expiresIn": 3600},
            timeout=20.0,
        )
        r.raise_for_status()
        signed = r.json().get("signedURL")
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="storage signing failed") from exc
    if not signed:
        raise HTTPException(status_code=502, detail="storage signing failed")
    return {"url": f"{settings.supabase_url}/storage/v1{signed}"}
