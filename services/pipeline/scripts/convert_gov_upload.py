"""One-off converter (M17): the consolidated CAFI 2025 shapefiles supplied by
the platform owner -> harmonised GeoJSON seeds under infra/data/gov_upload_2025.

Input (not in the repo): a folder with
  CFCL_AFF_CAFI_2025_polygon  -> community_forest_zoning
  CFCL_LIM_CAFI_2025          -> community_forests (load-time: only missing)
  PSAT_LIM_CAFI_2025          -> local_territories
  CLD_CAFI_2025 (points)      -> local_governance ("Local governance body")

Usage: python convert_gov_upload.py <shapefile-dir> <out-dir>
Requires: pyshp. The seeds carry final gov_areas property names; everything
database-dependent (CFCL dedupe, parent matching, display geometry) happens
in load_gov_upload.py.
"""

import gzip
import json
import re
import sys
import unicodedata
from pathlib import Path

import shapefile  # pyshp

SRC_VINTAGE = "2025"
COUNTRY = "Democratic Republic of Congo"
ISO3 = "COD"

ZONE_MAP = {
    "serie de protection": "protection",
    "serie de savane mise en defens": "savanna_protection",
    "serie de conservation": "conservation",
    "serie de production permanente": "production",
    "serie de developpement rural": "community_development",
}

ATTRIBUTED = {"valide", "approuve", "titre cfcl attribue"}


def fold(text: str) -> str:
    out = unicodedata.normalize("NFKD", text)
    return "".join(c for c in out if not unicodedata.combining(c)).strip().lower()


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", fold(text)).strip("-") or "sans-nom"


def clean(v) -> str | None:
    s = str(v).strip() if v is not None else ""
    return s if s and s.upper() not in ("N/A", "NA", "NONE", "NULL") else None


def num(v):
    try:
        f = float(str(v).strip())
        return f if f == f else None
    except (TypeError, ValueError):
        return None


def year(v):
    n = num(v)
    return int(n) if n and 1900 < n < 2100 else None


def status_std(v) -> str | None:
    s = clean(v)
    return "attributed" if s and fold(s) in ATTRIBUTED else None


def base_props(d: dict, layer: str, src_layer: str) -> dict:
    return {
        "layer": layer,
        "country": COUNTRY,
        "iso3": ISO3,
        "province": clean(d.get("Province")),
        "admin2": clean(d.get("Territoire")),
        "admin3": clean(d.get("Secteur")),
        "admin4": clean(d.get("Groupement")),
        "programme": clean(d.get("Programme")),
        "funder": clean(d.get("Finance")),
        "agency": clean(d.get("Agence")),
        "partner": clean(d.get("Partenaire")),
        "year_ref": year(d.get("Annee")),
        "area_calc_ha": num(d.get("Area_ha")),
        "status_raw": clean(d.get("Statut")),
        "status_std": status_std(d.get("Statut")),
        "situation": "complete",
        "geom_quality": "bbox" if fold(str(d.get("bbox_only", ""))) == "true" else "exact",
        "src_layer": src_layer,
        "src_file": clean(d.get("Source_fil")),
        "src_vintage": SRC_VINTAGE,
        "src_attrs_json": json.dumps(
            {k: v for k, v in d.items() if clean(v) is not None},
            ensure_ascii=False,
            default=str,
        ),
    }


def convert(src_dir: Path, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    counters: dict[str, int] = {}

    def uid(layer: str, name: str) -> str:
        key = f"{layer}:{slug(name)}"
        counters[key] = counters.get(key, 0) + 1
        n = counters[key]
        return f"{ISO3}:upl:{key}" + (f":{n}" if n > 1 else "")

    def rows(stem: str):
        r = shapefile.Reader(str(src_dir / stem))
        fields = [f[0] for f in r.fields[1:]]
        for sr in r.iterShapeRecords():
            yield dict(zip(fields, sr.record)), sr.shape.__geo_interface__

    def dump(name: str, features: list[dict]) -> None:
        fc = {"type": "FeatureCollection", "features": features}
        path = out_dir / f"{name}.geojson.gz"
        with gzip.open(path, "wt", encoding="utf-8") as fh:
            json.dump(fc, fh, ensure_ascii=False)
        print(f"{name}: {len(features)} features -> {path}")

    # community forest zoning (series within a CFCL terroir)
    feats = []
    for d, geom in rows("CFCL_AFF_CAFI_2025_polygon"):
        terroir = clean(d.get("Terroir"))
        zraw = clean(d.get("Zonage"))
        p = base_props(d, "community_forest_zoning", "CFCL_AFF_CAFI_2025_polygon")
        p["src_uid"] = uid("cfclz", f"{terroir or 'zone'}-{zraw or 'nc'}")
        p["name"] = " · ".join(x for x in (terroir, zraw) if x) or None
        p["community"] = terroir
        p["extras"] = {
            "zone_type_std": ZONE_MAP.get(fold(zraw or ""), "unclassified"),
            "zone_type_raw": zraw,
            "parent_name": terroir,
        }
        feats.append({"type": "Feature", "geometry": geom, "properties": p})
    dump("community_forest_zoning", feats)

    # community forest limits (only-missing is enforced at load time)
    feats = []
    for d, geom in rows("CFCL_LIM_CAFI_2025"):
        terroir = clean(d.get("Terroir"))
        p = base_props(d, "community_forests", "CFCL_LIM_CAFI_2025")
        p["src_uid"] = uid("cfcl", terroir or "sans-nom")
        p["name"] = terroir
        p["sub_type_std"] = "cfcl"
        p["community"] = clean(d.get("Beneficiai")) or terroir
        p["extras"] = {
            "exploitation": clean(d.get("Exploitati")),
            "certification": clean(d.get("Certificat")),
            "operator_raw": clean(d.get("Exploitant")),
            "land_tenure": clean(d.get("Foncier")),
        }
        feats.append({"type": "Feature", "geometry": geom, "properties": p})
    dump("community_forests", feats)

    # local territory limits (PSAT)
    feats = []
    for d, geom in rows("PSAT_LIM_CAFI_2025"):
        name = clean(d.get("Nom")) or clean(d.get("Terroir"))
        p = base_props(d, "local_territories", "PSAT_LIM_CAFI_2025")
        p["src_uid"] = uid("psat", name or "terroir")
        p["name"] = name
        p["community"] = clean(d.get("Beneficiai"))
        p["extras"] = {"cld": clean(d.get("CLD"))}
        feats.append({"type": "Feature", "geometry": geom, "properties": p})
    dump("local_territories", feats)

    # local governance bodies (CLD) — point features
    feats = []
    for d, geom in rows("CLD_CAFI_2025"):
        name = (
            clean(d.get("Nom"))
            or clean(d.get("Nom_du_vil"))
            or clean(d.get("Terroir"))
        )
        p = base_props(d, "local_governance", "CLD_CAFI_2025")
        p["src_uid"] = uid("cld", name or "cld")
        p["name"] = name
        p["holder"] = clean(d.get("Responsabl"))
        p["extras"] = {
            "population": num(d.get("Population")),
            "village": clean(d.get("Nom_du_vil")),
        }
        feats.append({"type": "Feature", "geometry": geom, "properties": p})
    dump("local_governance", feats)


if __name__ == "__main__":
    convert(Path(sys.argv[1]), Path(sys.argv[2]))
