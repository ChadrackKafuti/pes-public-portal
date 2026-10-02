"""Load the consolidated CAFI 2025 governance seeds (M17) into gov_areas.

Reads infra/data/gov_upload_2025/*.geojson.gz (made by convert_gov_upload.py)
and upserts them with src_system prefix COD:upl:. Database-dependent rules:

- community_forests: only rows whose (folded) name does NOT already exist on
  the fetched community-forests layer are inserted ("only add the missing").
- community_forest_zoning: parent_uid resolves by terroir name against ALL
  community forests (fetched + uploaded), so the inspector's zoning donut
  works on either parent.
- geom_display: simplified polygons (shapely, topology-preserving).

Idempotent: ON CONFLICT (src_uid) DO UPDATE. Prints aggregate counts only.
Usage: CAFI_DATABASE_URL=... python load_gov_upload.py [seed-dir]
"""

import gzip
import json
import os
import sys
import unicodedata
from pathlib import Path

import psycopg
from shapely.geometry import mapping, shape

SEED_DIR = Path(sys.argv[1] if len(sys.argv) > 1 else "infra/data/gov_upload_2025")
ORDER = [  # parents before zoning so parent matching sees uploaded CFCLs
    "community_forests",
    "community_forest_zoning",
    "local_territories",
    "local_governance",
]

_COLS = [
    "src_uid", "layer", "country", "iso3", "sub_type_std", "name", "holder",
    "community", "province", "admin2", "admin3", "admin4", "status_raw",
    "status_std", "area_calc_ha", "doc_count", "situation", "programme",
    "funder", "agency", "partner", "year_ref", "geom_quality", "src_layer",
    "src_file", "src_vintage", "src_attrs_json", "retired", "parent_uid",
    "centroid_x", "centroid_y", "extras", "geom_geojson", "geom_display",
]

_SQL = f"""
INSERT INTO gov_areas ({", ".join(_COLS)}, loaded_at)
VALUES ({", ".join(f"%({c})s" for c in _COLS)}, now())
ON CONFLICT (src_uid) DO UPDATE SET
  {", ".join(f"{c} = EXCLUDED.{c}" for c in _COLS if c != "src_uid")},
  loaded_at = now()
"""


def fold(text: str) -> str:
    out = unicodedata.normalize("NFKD", text or "")
    return "".join(c for c in out if not unicodedata.combining(c)).strip().lower()


def read(name: str) -> list[dict]:
    with gzip.open(SEED_DIR / f"{name}.geojson.gz", "rt", encoding="utf-8") as fh:
        return json.load(fh)["features"]


def display_geom(geom) -> dict:
    if geom.geom_type not in ("Polygon", "MultiPolygon"):
        return mapping(geom)
    simplified = geom.simplify(0.0003, preserve_topology=True)
    return mapping(simplified if not simplified.is_empty else geom)


def main() -> None:
    url = os.environ["CAFI_DATABASE_URL"]
    stats: dict[str, dict] = {}
    with psycopg.connect(url, prepare_threshold=None) as conn:
        existing_cf = {
            fold(n): u
            for u, n in conn.execute(
                """
                SELECT src_uid, name FROM gov_areas
                WHERE layer = 'community_forests' AND retired = 0
                  AND name IS NOT NULL AND src_uid NOT LIKE %s
                """,
                ("COD:upl:%",),
            ).fetchall()
        }
        uploaded_cf: dict[str, str] = {}

        for layer in ORDER:
            inserted = skipped = linked = 0
            for f in read(layer):
                p = f["properties"]
                geom = shape(f["geometry"])
                if layer == "community_forests":
                    key = fold(p.get("name") or "")
                    if key and key in existing_cf:
                        skipped += 1  # already on the fetched layer
                        continue
                    if key:
                        uploaded_cf[key] = p["src_uid"]
                if layer == "community_forest_zoning":
                    parent = fold((p.get("extras") or {}).get("parent_name") or "")
                    p["parent_uid"] = (
                        uploaded_cf.get(parent) or existing_cf.get(parent)
                    )
                    if p["parent_uid"]:
                        linked += 1
                c = geom.centroid
                row = {col: p.get(col) for col in _COLS}
                row.update(
                    doc_count=0,
                    retired=0,
                    parent_uid=p.get("parent_uid"),
                    centroid_x=c.x,
                    centroid_y=c.y,
                    extras=json.dumps(p.get("extras") or {}),
                    geom_geojson=json.dumps(f["geometry"]),
                    geom_display=json.dumps(display_geom(geom)),
                )
                conn.execute(_SQL, row)
                inserted += 1
            conn.commit()
            stats[layer] = {"upserted": inserted, "skipped_existing": skipped,
                            "parent_linked": linked}
    print(json.dumps(stats, indent=1))


if __name__ == "__main__":
    main()
