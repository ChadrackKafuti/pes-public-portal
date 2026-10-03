"""Road & access-change detection on NICFI basemaps (M28).

For parcels under sustainable forest management or conservation — where a
new road or skid trail is the best early predictor of over-harvest — each
rotation fetches two Planet NICFI monthly basemap chips (latest mosaic vs
~6 months earlier) around the parcel and asks Claude vision to compare
them: new roads/trails, new clearings, confidence, one-line summary. A
confident detection opens a 'road' incident in the M23 state machine.

Needs CAFI_RS_NICFI_KEY (Planet API key) and CAFI_RS_ANTHROPIC_API_KEY;
with either missing the pass is disabled. Record ids stay out of the
public workflow logs.
"""

import base64
import json
import logging
import math
from datetime import UTC, datetime, timedelta

import httpx

from .config import PipelineConfig

log = logging.getLogger(__name__)

_MOSAICS_URL = "https://api.planet.com/basemaps/v1/mosaics"
_TILE_URL = "https://tiles.planet.com/basemaps/v1/planet-tiles/{name}/gmap/{z}/{x}/{y}.png"

# Structured-outputs subset: no numeric/string constraints — ranges go in
# the description (type arrays would 400 too; none are needed here).
_SCHEMA = {
    "type": "object",
    "properties": {
        "new_road_or_trail": {"type": "boolean"},
        "new_clearing": {"type": "boolean"},
        "confidence": {"type": "number", "description": "0 to 1"},
        "summary": {"type": "string", "description": "one sentence, max 300 chars"},
    },
    "required": ["new_road_or_trail", "new_clearing", "confidence", "summary"],
    "additionalProperties": False,
}

_PROMPT = """\
These are two satellite basemap images (≈4.7 m/pixel) of the same tropical
forest area in the Congo Basin. The FIRST image is the reference, from
mosaic {ref}. The SECOND is recent, from mosaic {recent}. The parcel is
under {regime}.

Compare them and report:
- new_road_or_trail: a linear feature (road, logging/skid trail) visible in
  the recent image but not the reference.
- new_clearing: a non-linear area of forest loss or bare ground that is new
  in the recent image.
- confidence: 0 to 1, considering haze, clouds and seasonal colour shifts —
  seasonal tone changes alone are NOT a detection.
- summary: one neutral sentence describing what changed, or that nothing
  structural changed.
"""


def tile_xyz(lon: float, lat: float, zoom: int) -> tuple[int, int]:
    """Slippy-map tile containing a point."""
    n = 2**zoom
    x = int((lon + 180.0) / 360.0 * n)
    lat_r = math.radians(lat)
    y = int((1.0 - math.log(math.tan(lat_r) + 1 / math.cos(lat_r)) / math.pi) / 2.0 * n)
    return min(max(x, 0), n - 1), min(max(y, 0), n - 1)


def list_visual_mosaics(http, key: str, prefix: str) -> list[str]:
    """Monthly visual mosaic names, oldest → newest."""
    r = http.get(
        _MOSAICS_URL,
        params={"name__contains": prefix, "_page_size": 500},
        auth=(key, ""),
    )
    r.raise_for_status()
    names = [m["name"] for m in r.json().get("mosaics", [])]
    return sorted(n for n in names if n.startswith(prefix))


def pick_epochs(names: list[str], months_back: int) -> tuple[str, str] | None:
    """(reference, recent): the latest mosaic and one ~months_back earlier."""
    if len(names) < 2:
        return None
    recent = names[-1]
    ref_idx = max(0, len(names) - 1 - months_back)
    if ref_idx == len(names) - 1:
        ref_idx -= 1
    return names[ref_idx], recent


def _centroid(shape_wkt: str | None, lon, lat) -> tuple[float, float] | None:
    if lon is not None and lat is not None and not (lon == 0 and lat == 0):
        return float(lon), float(lat)
    if not shape_wkt:
        return None
    try:
        from shapely import wkt as shapely_wkt

        c = shapely_wkt.loads(shape_wkt).centroid
        return float(c.x), float(c.y)
    except Exception:  # noqa: BLE001 — bad shape: parcel stays unchecked
        return None


def analyze_pair(client, model: str, ref_png: bytes, recent_png: bytes,
                 ref_name: str, recent_name: str, regime: str) -> dict:
    def img(data: bytes) -> dict:
        return {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": "image/png",
                "data": base64.b64encode(data).decode("ascii"),
            },
        }

    response = client.messages.create(
        model=model,
        max_tokens=512,
        output_config={"format": {"type": "json_schema", "schema": _SCHEMA}},
        messages=[{
            "role": "user",
            "content": [
                img(ref_png),
                img(recent_png),
                {"type": "text", "text": _PROMPT.format(
                    ref=ref_name, recent=recent_name, regime=regime,
                )},
            ],
        }],
    )
    text = next(b.text for b in response.content if b.type == "text")
    return json.loads(text)


# SFM and conservation parcels, stalest-first with the country priority
# (ROC → DRC → Cameroon) used across the AI passes.
_CANDIDATES_SQL = """
SELECT p.application_id, p.shape_raw, p.point_lon, p.point_lat, p.pes_activity
FROM pes_parcels p
LEFT JOIN pes_basemap_checks b ON b.application_id = p.application_id
WHERE NOT (p.application_id = ANY(%(hidden)s))
  AND (p.pes_activity ILIKE '%%manage%%' OR p.pes_activity ILIKE '%%gestion%%'
       OR p.pes_activity ILIKE '%%aménag%%' OR p.pes_activity ILIKE '%%amenag%%'
       OR p.pes_activity ILIKE '%%conserv%%' OR p.pes_activity ILIKE '%%protect%%')
  AND (b.checked_utc IS NULL OR b.checked_utc < %(stale_before)s)
ORDER BY
  CASE
    WHEN p.country ILIKE '%%cameroon%%' OR p.country ILIKE '%%cameroun%%' THEN 2
    WHEN p.country ILIKE '%%democratic%%' OR p.country ILIKE '%%démocratique%%'
         OR p.country ILIKE 'DRC%%' OR p.country ILIKE 'RDC%%' THEN 1
    WHEN p.country ILIKE '%%congo%%' OR p.country ILIKE 'ROC%%' THEN 0
    ELSE 3
  END,
  b.checked_utc ASC NULLS FIRST
LIMIT %(limit)s
"""


def process_roads(
    conn,
    config: PipelineConfig,
    hidden_ids: set[str] | None = None,
    *,
    client=None,
    fetch_tile=None,
    mosaics: list[str] | None = None,
) -> dict:
    """One rotation of basemap change checks within the road budget.

    `client`, `fetch_tile(name, z, x, y) -> bytes` and `mosaics` are
    injectable for tests; defaults use the Anthropic SDK and Planet tiles."""
    if (not config.nicfi_key and fetch_tile is None) or (
        not config.anthropic_api_key and client is None
    ):
        return {"roads": "disabled"}

    rows = conn.execute(
        _CANDIDATES_SQL,
        {
            "hidden": sorted(hidden_ids or ()),
            "stale_before": datetime.now(UTC) - timedelta(days=config.road_recheck_days),
            "limit": config.road_batch,
        },
    ).fetchall()
    if not rows:
        return {"roads_checked": 0, "roads_detected": 0, "roads_failed": 0}

    if client is None:
        import anthropic

        client = anthropic.Anthropic(api_key=config.anthropic_api_key)

    deadline = datetime.now(UTC) + timedelta(seconds=config.road_budget_s)
    checked = detected = failed = 0
    with httpx.Client(timeout=60.0, follow_redirects=True) as http:
        try:
            names = mosaics if mosaics is not None else list_visual_mosaics(
                http, config.nicfi_key, config.nicfi_mosaic_prefix
            )
        except Exception as exc:  # noqa: BLE001 — no mosaic list: nothing to do
            log.warning("NICFI mosaic listing failed: %s", type(exc).__name__)
            return {"roads": "mosaics_unavailable"}
        epochs = pick_epochs(names, config.road_compare_months)
        if epochs is None:
            return {"roads": "mosaics_unavailable"}
        ref_name, recent_name = epochs

        if fetch_tile is None:
            def fetch_tile(name, z, x, y, _http=http):
                r = _http.get(
                    _TILE_URL.format(name=name, z=z, x=x, y=y),
                    params={"api_key": config.nicfi_key},
                )
                r.raise_for_status()
                return r.content

        from .indicators.nrt import _record_detection, _resolve_quiet

        for app_id, shape, lon, lat, activity in rows:
            if datetime.now(UTC) >= deadline:
                break
            try:
                center = _centroid(shape, lon, lat)
                if center is None:
                    continue
                x, y = tile_xyz(center[0], center[1], config.road_zoom)
                ref_png = fetch_tile(ref_name, config.road_zoom, x, y)
                recent_png = fetch_tile(recent_name, config.road_zoom, x, y)
                data = analyze_pair(
                    client, config.photo_ai_model, ref_png, recent_png,
                    ref_name, recent_name, activity or "forest protection",
                )
                hit = (
                    (data["new_road_or_trail"] or data["new_clearing"])
                    and data["confidence"] >= config.road_min_confidence
                )
                if hit:
                    _record_detection(
                        conn, str(app_id), "road",
                        int(round(data["confidence"] * 100)),
                        datetime.now(UTC).date(),
                    )
                    detected += 1
                else:
                    _resolve_quiet(
                        conn, str(app_id), "road",
                        datetime.now(UTC).date() - timedelta(days=1),
                    )
                conn.execute(
                    """
                    INSERT INTO pes_basemap_checks
                      (application_id, checked_utc, mosaic_recent, mosaic_reference,
                       new_road, new_clearing, confidence, summary)
                    VALUES (%s, now(), %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (application_id) DO UPDATE SET
                      checked_utc = now(), mosaic_recent = EXCLUDED.mosaic_recent,
                      mosaic_reference = EXCLUDED.mosaic_reference,
                      new_road = EXCLUDED.new_road,
                      new_clearing = EXCLUDED.new_clearing,
                      confidence = EXCLUDED.confidence, summary = EXCLUDED.summary
                    """,
                    (
                        app_id, recent_name, ref_name, data["new_road_or_trail"],
                        data["new_clearing"], data["confidence"], data["summary"],
                    ),
                )
                conn.commit()
                checked += 1
            except Exception as exc:  # noqa: BLE001 — one parcel never sinks the pass
                conn.rollback()
                failed += 1
                log.warning("basemap check failed: %s", type(exc).__name__)
                if type(exc).__name__ == "BadRequestError":
                    log.warning("request rejected: %s", str(exc)[:300])
                if type(exc).__name__ in ("RateLimitError", "AuthenticationError"):
                    break
    return {"roads_checked": checked, "roads_detected": detected,
            "roads_failed": failed, "roads_epochs": f"{ref_name}->{recent_name}"}
