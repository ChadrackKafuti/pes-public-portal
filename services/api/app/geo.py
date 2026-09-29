"""Parcel geometries as GeoJSON for the map workspace.

Geometry reaches the frontend only through here (staff tier); the public tier
never gets this route (spec §9: tabular only).
"""

import json
import logging

log = logging.getLogger(__name__)


def shape_to_geometry(
    shape_raw: str | bytes | None, lon: float | None, lat: float | None
) -> dict | None:
    """Parse a parcel's raw shape (WKT or GeoJSON text, spec §6.4) into a
    GeoJSON geometry; fall back to a Point; None when neither is usable.

    Accepts bytes too: psycopg returns text as bytes when the server encoding
    is SQL_ASCII (e.g. a locale-C dev cluster)."""
    if isinstance(shape_raw, bytes):
        shape_raw = shape_raw.decode("utf-8", errors="replace")
    if shape_raw:
        s = shape_raw.strip()
        try:
            if s.startswith("{"):
                geom = json.loads(s)
                if isinstance(geom, dict) and "type" in geom and "coordinates" in geom:
                    return geom
            else:
                from shapely import from_wkt
                from shapely.geometry import mapping

                return json.loads(json.dumps(mapping(from_wkt(s))))
        except Exception:  # noqa: BLE001 — malformed shape falls through to the point
            log.exception("unparseable shape_raw; falling back to point")
    if lon is not None and lat is not None:
        return {"type": "Point", "coordinates": [lon, lat]}
    return None
