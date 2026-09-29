"""Parcel geometry resolution — spec §4 step 4 and §11.8.

Priority order: own polygon; for monitoring visits, the parent application's
parcel; a point buffer for applications with Point + EstimatedArea; otherwise
an exception. The geometry hash (spec §3) fingerprints Shape and Point only —
EstimatedArea is deliberately excluded.
"""

import hashlib
import math

from .models import GeomSource, PesObject


def buffer_radius_m(estimated_area_ha: float) -> float:
    """Spec §11.8: r = sqrt(area_ha * 10_000 / pi) metres."""
    if estimated_area_ha <= 0:
        raise ValueError("estimated area must be positive")
    return math.sqrt(estimated_area_ha * 10_000 / math.pi)


def geom_input_hash(shape_wkt: str | None, point: tuple[float, float] | None) -> str:
    """Change-detection fingerprint over the two geometry inputs (spec §3)."""
    h = hashlib.sha256()
    h.update((shape_wkt or "").encode())
    h.update(repr(point).encode())
    return h.hexdigest()[:32]


def resolve_geom_source(
    obj: PesObject, parent: PesObject | None = None
) -> tuple[GeomSource, PesObject] | None:
    """Pick the geometry-bearing record and label its source.

    Returns None when no usable geometry exists (caller writes a
    `no_usable_geometry` exception row).
    """
    if obj.shape_wkt:
        return GeomSource.POLYGON, obj
    if obj.point and obj.estimated_area_ha:
        return GeomSource.BUFFERED_POINT, obj
    if parent is not None:
        if parent.shape_wkt:
            return GeomSource.POLYGON_INHERITED, parent
        if parent.point and parent.estimated_area_ha:
            return GeomSource.BUFFERED_POINT_INHERITED, parent
    return None
