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


@router.get("/api/photos.geojson")
def photos_geojson(
    application: str | None = None,
    kind: str | None = None,
    conn=Depends(get_conn),
    user: Principal = CurrentUser,
) -> dict:
    rows = _rows(conn, application, kind, 10000)
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [r[8], r[9]]},
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
            for r in rows
        ],
    }


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
