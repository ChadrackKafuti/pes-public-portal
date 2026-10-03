"""Photo intelligence (M26) — one Claude vision pass per mirrored photo.

Each geotagged photo gets a structured reading: what the scene shows,
whether it is consistent with the parcel's declared PES activity, a
tree/sapling count where countable, vegetation health, a species guess,
and red flags (clearing, fire damage, charcoal). Results live on the
photo row and feed the dossier, the map popup, and incident evidence.

The pass is disabled until CAFI_RS_ANTHROPIC_API_KEY is configured; it
drains newest-first inside its own small time budget, and every attempt
is stamped so a failing photo never thrashes the queue. Photo ids stay
out of the public workflow logs — aggregates only.
"""

import base64
import json
import logging
from datetime import UTC, datetime, timedelta

import httpx

from .config import PipelineConfig

log = logging.getLogger(__name__)

SCENES = [
    "crops", "saplings_plantation", "mature_trees", "agroforestry_mix",
    "savannah_grassland", "bare_or_cleared_land", "fire_damage",
    "charcoal_production", "people_or_meeting", "document_or_screen",
    "buildings_or_village", "other",
]
HEALTH = ["healthy", "stressed", "dead_or_dying", "not_applicable"]
FLAGS = ["clearing", "fire_damage", "charcoal", "logging", "erosion",
         "off_parcel_doubt", "poor_quality_image"]

# NOTE: the structured-outputs schema subset rejects type arrays
# (["x","null"]) and numeric/string constraints (minimum, maxLength...) —
# nullable fields use anyOf, and ranges live in descriptions.
def _nullable(t: str) -> dict:
    return {"anyOf": [{"type": t}, {"type": "null"}]}


_SCHEMA = {
    "type": "object",
    "properties": {
        "scene": {"type": "string", "enum": SCENES},
        "scene_confidence": {"type": "number", "description": "0 to 1"},
        "activity_consistent": _nullable("boolean"),
        "tree_count": {
            **_nullable("integer"),
            "description": "non-negative; null when not countable",
        },
        "health": {"type": "string", "enum": HEALTH},
        "species_guess": _nullable("string"),
        "flags": {"type": "array", "items": {"type": "string", "enum": FLAGS}},
        "summary": {"type": "string", "description": "one sentence, max 300 chars"},
    },
    "required": [
        "scene", "scene_confidence", "activity_consistent", "tree_count",
        "health", "species_guess", "flags", "summary",
    ],
    "additionalProperties": False,
}

_PROMPT = """\
You are analysing a geotagged field photo from a Payments for Environmental
Services (PES) programme in the Congo Basin. The parcel's declared activity
is: "{activity}". The photo was taken as {kind} evidence.

Read the photo and answer:
- scene: the single best-matching scene class.
- scene_confidence: your confidence in that class, 0 to 1.
- activity_consistent: does the scene plausibly belong to a parcel doing the
  declared activity? null when the photo cannot answer this (e.g. a photo of
  people or a document).
- tree_count: planted trees/saplings clearly countable in frame, else null.
- health: dominant vegetation condition, not_applicable when no vegetation.
- species_guess: the most likely tree/crop species visible (common or Latin
  name), null when none is identifiable.
- flags: every red flag that applies, empty list when none.
- summary: one short neutral sentence describing what the photo shows.
"""


def analyze_photo(client, model: str, image: bytes, media_type: str,
                  activity: str | None, kind: str) -> dict:
    """One structured vision call; raises on transport/validation errors."""
    response = client.messages.create(
        model=model,
        max_tokens=1024,
        output_config={"format": {"type": "json_schema", "schema": _SCHEMA}},
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": media_type,
                        "data": base64.b64encode(image).decode("ascii"),
                    },
                },
                {
                    "type": "text",
                    "text": _PROMPT.format(
                        activity=activity or "not recorded",
                        kind="a monitoring-visit" if kind == "monitoring_visit"
                        else "an application",
                    ),
                },
            ],
        }],
    )
    text = next(b.text for b in response.content if b.type == "text")
    return json.loads(text)


_CANDIDATES_SQL = """
SELECT ph.photo_uid, ph.kind, ph.mirrored_path, p.pes_activity
FROM pes_photos ph
LEFT JOIN pes_parcels p ON p.application_id = ph.application_id
WHERE ph.mirror_status = 'done' AND ph.mirrored_path IS NOT NULL
  AND ph.ai_processed_utc IS NULL
  AND NOT (coalesce(ph.application_id, '') = ANY(%(hidden)s))
ORDER BY
  -- Country priority (requested): Republic of Congo, then DRC, then
  -- Cameroon, then anything else. Matched loosely because source labels
  -- vary ("DRC", "Democratic Republic of the Congo", "ROC", FR spellings).
  CASE
    WHEN p.country ILIKE '%%cameroon%%' OR p.country ILIKE '%%cameroun%%' THEN 2
    WHEN p.country ILIKE '%%democratic%%' OR p.country ILIKE '%%démocratique%%'
         OR p.country ILIKE 'DRC%%' OR p.country ILIKE 'RDC%%' THEN 1
    WHEN p.country ILIKE '%%congo%%' OR p.country ILIKE 'ROC%%' THEN 0
    ELSE 3
  END,
  ph.synced_utc DESC
LIMIT %(limit)s
"""

_MEDIA_BY_EXT = {"png": "image/png", "webp": "image/webp", "gif": "image/gif"}


def _fetch_mirrored(config: PipelineConfig, http, path: str) -> tuple[bytes, str]:
    r = http.get(
        f"{config.supabase_url}/storage/v1/object/{config.photos_bucket}/{path}",
        headers={"Authorization": f"Bearer {config.supabase_service_key}"},
    )
    r.raise_for_status()
    media = r.headers.get("content-type", "").split(";")[0]
    if media not in ("image/jpeg", *_MEDIA_BY_EXT.values()):
        media = _MEDIA_BY_EXT.get(path.rsplit(".", 1)[-1].lower(), "image/jpeg")
    return r.content, media


def process_photo_ai(
    conn,
    config: PipelineConfig,
    hidden_ids: set[str] | None = None,
    *,
    client=None,
    fetch_image=None,
) -> dict:
    """Analyse pending mirrored photos within the photo-AI budget.

    `client` and `fetch_image` are injectable for tests; by default the
    Anthropic SDK client and the Supabase storage download are used."""
    if not config.anthropic_api_key and client is None:
        return {"photo_ai": "disabled"}
    if not (config.supabase_url and config.supabase_service_key) and fetch_image is None:
        return {"photo_ai": "no_storage"}

    rows = conn.execute(
        _CANDIDATES_SQL,
        {"hidden": sorted(hidden_ids or ()), "limit": config.photo_ai_batch},
    ).fetchall()
    if not rows:
        return {"photo_ai_done": 0, "photo_ai_failed": 0, "photo_ai_pending": 0}

    if client is None:
        import anthropic

        client = anthropic.Anthropic(api_key=config.anthropic_api_key)

    deadline = datetime.now(UTC) + timedelta(seconds=config.photo_ai_budget_s)
    done = failed = 0
    with httpx.Client(timeout=60.0, follow_redirects=True) as http:
        if fetch_image is None:
            def fetch_image(path, _http=http):  # noqa: E731-adjacent — bound default
                return _fetch_mirrored(config, _http, path)

        for uid, kind, path, activity in rows:
            if datetime.now(UTC) >= deadline:
                break
            try:
                image, media = fetch_image(path)
                if len(image) > config.max_photo_bytes:
                    raise ValueError("photo larger than configured limit")
                data = analyze_photo(
                    client, config.photo_ai_model, image, media, activity, kind
                )
                conn.execute(
                    """
                    UPDATE pes_photos SET
                      ai_scene = %s, ai_scene_confidence = %s,
                      ai_activity_consistent = %s, ai_tree_count = %s,
                      ai_health = %s, ai_species = %s, ai_flags = %s,
                      ai_summary = %s, ai_model = %s, ai_status = 'ok',
                      ai_processed_utc = now()
                    WHERE photo_uid = %s
                    """,
                    (
                        data["scene"], data["scene_confidence"],
                        data["activity_consistent"], data["tree_count"],
                        data["health"], data["species_guess"],
                        ",".join(data["flags"]) or None,
                        data["summary"], config.photo_ai_model, uid,
                    ),
                )
                conn.commit()
                done += 1
            except Exception as exc:  # noqa: BLE001 — one photo never sinks the pass
                conn.rollback()
                failed += 1
                log.warning("photo analysis failed: %s", type(exc).__name__)
                if type(exc).__name__ == "BadRequestError":
                    log.warning("request rejected: %s", str(exc)[:300])
                try:
                    conn.execute(
                        "UPDATE pes_photos SET ai_status = 'failed', "
                        "ai_processed_utc = now() WHERE photo_uid = %s",
                        (uid,),
                    )
                    conn.commit()
                except Exception:  # noqa: BLE001
                    conn.rollback()
                # A rate-limited API will refuse the rest of the batch too.
                if type(exc).__name__ in ("RateLimitError", "AuthenticationError"):
                    break
    return {"photo_ai_done": done, "photo_ai_failed": failed,
            "photo_ai_pending": len(rows)}
