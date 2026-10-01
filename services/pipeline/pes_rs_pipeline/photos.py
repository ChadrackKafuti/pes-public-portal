"""Geotagged photos — port of the v1 ArcGIS PhotoLoad workflow (M7a).

Applications carry ``ApplicationGeotaggedPhotos`` and monitoring visits
``MonitoringVisitGeoTaggedPhotos``: JSON arrays of ``{url, lat, lon, label}``.
The URLs carry short-lived SAS query strings, so every run refreshes the
stored URL and mirrors not-yet-mirrored images into Supabase Storage (a
private bucket); the stable identity is
``PhotoUid = sha1(parent|field|index|url-without-query|lon|lat)``,
exactly as the notebook computed it, so re-runs are idempotent.
"""

import hashlib
import html
import json
import logging
import re
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlparse

import httpx

from .config import PipelineConfig
from .pes_api import _pick

log = logging.getLogger(__name__)

PHOTO_FIELDS = {
    "application": "ApplicationGeotaggedPhotos",
    "monitoring_visit": "MonitoringVisitGeoTaggedPhotos",
}


# -- pure helpers (notebook ports) ----------------------------------------

def _ci_get(record: dict, key: str) -> Any:
    lowered = {str(k).lower(): v for k, v in record.items()}
    return lowered.get(key.lower())


def extract_http_url(value: Any, max_len: int = 2000) -> str | None:
    if value in (None, "", "null", "None"):
        return None
    txt = html.unescape(str(value)).strip().strip('"').strip("'")
    m = re.search(r'href\s*=\s*["\']([^"\']+)["\']', txt, flags=re.IGNORECASE)
    if m:
        return m.group(1).strip()[:max_len]
    m = re.search(r'https?://[^\s"\'<>]+', txt, flags=re.IGNORECASE)
    if m:
        return m.group(0).strip().rstrip(",.")[:max_len]
    return txt[:max_len] or None


def url_without_query(url: str | None) -> str | None:
    """Strip the expiring SAS query string — the stable part of the URL."""
    if not url:
        return None
    clean = extract_http_url(url)
    if not clean:
        return None
    try:
        p = urlparse(clean)
        if p.scheme and p.netloc:
            return f"{p.scheme}://{p.netloc}{p.path}"
    except ValueError:
        pass
    return clean.split("?")[0]


def parse_photo_array(value: Any) -> list[dict]:
    if value in (None, "", "null", "None", []):
        return []
    data = value
    if isinstance(data, str):
        data = html.unescape(data).strip()
        try:
            data = json.loads(data)
        except (json.JSONDecodeError, ValueError):
            return []
    if not isinstance(data, list):
        return []
    return [p for p in data if isinstance(p, dict)]


def _to_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _valid_lon_lat(lon: Any, lat: Any) -> tuple[float, float] | tuple[None, None]:
    flon, flat = _to_float(lon), _to_float(lat)
    if flon is None or flat is None or abs(flon) > 180 or abs(flat) > 90:
        return None, None
    return flon, flat


def _sha1(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8", errors="ignore")).hexdigest()


def photo_rows(records: list[dict], kind: str) -> list[dict]:
    """Flatten one endpoint's records into photo rows (pure)."""
    field = PHOTO_FIELDS[kind]
    out: list[dict] = []
    for rec in records:
        if not isinstance(rec, dict):
            continue
        photos = parse_photo_array(_ci_get(rec, field))
        if not photos:
            continue
        if kind == "application":
            parent = _pick(rec, "id")
            application_id = parent
            application_code = _pick(rec, "application_code")
            contract_code = None
        else:
            parent = _pick(rec, "visit_id")
            application_id = _pick(rec, "application_ref")
            application_code = _pick(rec, "application_code")
            contract_code = _pick(rec, "contract_code")
        for index, p in enumerate(photos, start=1):
            url = extract_http_url(p.get("url"))
            if not url or not url.lower().startswith(("http://", "https://")):
                continue
            lon, lat = _valid_lon_lat(p.get("lon"), p.get("lat"))
            if lon is None or lat is None:
                continue
            no_query = url_without_query(url)
            uid = _sha1(
                "|".join(
                    [
                        str(parent or ""), field, str(index),
                        str(no_query or ""), f"{lon:.8f}", f"{lat:.8f}",
                    ]
                )
            )
            label = p.get("label")
            out.append(
                {
                    "photo_uid": uid,
                    "kind": kind,
                    "parent_id": str(parent) if parent is not None else None,
                    "application_id": str(application_id) if application_id is not None else None,
                    "application_code": str(application_code) if application_code is not None else None,
                    "contract_code": str(contract_code) if contract_code is not None else None,
                    "photo_index": index,
                    "label": (str(label).strip()[:255] or "Photo") if label else "Photo",
                    "url": url,
                    "url_no_query": no_query,
                    "lon": lon,
                    "lat": lat,
                }
            )
    return out


# -- persistence -----------------------------------------------------------

_UPSERT = """
INSERT INTO pes_photos
  (photo_uid, kind, parent_id, application_id, application_code, contract_code,
   photo_index, label, url, url_no_query, lon, lat, synced_utc)
VALUES (%(photo_uid)s, %(kind)s, %(parent_id)s, %(application_id)s,
        %(application_code)s, %(contract_code)s, %(photo_index)s, %(label)s,
        %(url)s, %(url_no_query)s, %(lon)s, %(lat)s, now())
ON CONFLICT (photo_uid) DO UPDATE SET
  label = EXCLUDED.label,
  url = EXCLUDED.url,
  application_id = EXCLUDED.application_id,
  application_code = EXCLUDED.application_code,
  contract_code = EXCLUDED.contract_code,
  synced_utc = now()
"""


def upsert_photos(conn, rows: list[dict]) -> int:
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(_UPSERT, rows)
    return len(rows)


_RAW_UPSERT = """
INSERT INTO pes_raw_records (kind, record_id, payload, synced_utc)
VALUES (%s, %s, %s, now())
ON CONFLICT (kind, record_id) DO UPDATE SET
  payload = EXCLUDED.payload, synced_utc = now()
"""


def upsert_raw_records(conn, kind: str, records: list[dict]) -> int:
    """Full-fidelity payload mirror: everything v1's popups showed derives
    from here without re-touching the fetch mapping."""
    rows = []
    for rec in records:
        rid = _pick(rec, "id") if kind == "application" else _pick(rec, "visit_id")
        if rid is None:
            continue
        rows.append((kind, str(rid), json.dumps(rec, ensure_ascii=False, default=str)))
    if rows:
        with conn.cursor() as cur:
            cur.executemany(_RAW_UPSERT, rows)
    return len(rows)


# -- storage mirror --------------------------------------------------------

def _storage_object_path(photo: dict) -> str:
    uid = photo["photo_uid"]
    ext = ".jpg"
    try:
        name = urlparse(photo["url_no_query"] or "").path
        _, dot, tail = name.rpartition(".")
        if dot and 1 <= len(tail) <= 5 and tail.isalnum():
            ext = "." + tail.lower()
    except (TypeError, ValueError):
        pass
    return f"{photo['kind']}/{uid[:2]}/{uid}{ext}"


def mirror_pending(conn, config: PipelineConfig, deadline: datetime) -> dict:
    """Download fresh-URL photos and upload to Supabase Storage until the
    photo budget deadline; per-photo failures are recorded, never fatal."""
    if not (config.supabase_url and config.supabase_service_key):
        return {"mirrored": 0, "failed": 0, "skipped_no_storage": True}
    rows = conn.execute(
        """
        SELECT photo_uid, kind, url, url_no_query
        FROM pes_photos
        WHERE mirror_status IS DISTINCT FROM 'done' AND url IS NOT NULL
        ORDER BY synced_utc DESC
        LIMIT 1000
        """
    ).fetchall()
    headers = {
        "Authorization": f"Bearer {config.supabase_service_key}",
        "x-upsert": "true",
    }
    mirrored = failed = 0
    with httpx.Client(timeout=60.0, follow_redirects=True) as http:
        for uid, kind, url, no_query in rows:
            if datetime.now(UTC) >= deadline:
                break
            photo = {"photo_uid": uid, "kind": kind, "url_no_query": no_query, "url": url}
            path = _storage_object_path(photo)
            try:
                r = http.get(url)
                r.raise_for_status()
                content = r.content
                if len(content) > config.max_photo_bytes:
                    raise ValueError(f"photo larger than {config.max_photo_bytes} bytes")
                content_type = r.headers.get("content-type", "image/jpeg").split(";")[0]
                up = http.post(
                    f"{config.supabase_url}/storage/v1/object/{config.photos_bucket}/{path}",
                    headers={**headers, "Content-Type": content_type},
                    content=content,
                )
                up.raise_for_status()
                conn.execute(
                    """
                    UPDATE pes_photos
                    SET mirror_status = 'done', mirrored_path = %s, mirror_error = NULL
                    WHERE photo_uid = %s
                    """,
                    (path, uid),
                )
                mirrored += 1
            except Exception as exc:  # noqa: BLE001 — isolation per photo
                failed += 1
                conn.execute(
                    """
                    UPDATE pes_photos
                    SET mirror_status = 'error', mirror_error = %s
                    WHERE photo_uid = %s
                    """,
                    (str(exc)[:500], uid),
                )
    return {"mirrored": mirrored, "failed": failed}


def sync_photos(
    conn, config: PipelineConfig, applications: list[dict], visits: list[dict]
) -> dict:
    """One run's photo pass: raw mirror, photo upsert, image mirroring."""
    stats: dict = {}
    stats["raw_app"] = upsert_raw_records(conn, "application", applications)
    stats["raw_mon"] = upsert_raw_records(conn, "monitoring_visit", visits)
    rows = photo_rows(applications, "application") + photo_rows(visits, "monitoring_visit")
    stats["photos"] = upsert_photos(conn, rows)
    deadline = datetime.now(UTC) + timedelta(seconds=config.photo_mirror_budget_s)
    stats.update(mirror_pending(conn, config, deadline))
    return stats
