"""Enrichment, spatial lookup, parent linking, dedup (notebook §5).

The Geom class keeps only the pure-python paths (arcpy geodesic area /
labelPoint fallbacks are gone with ArcGIS Pro).
"""

import math
from collections import defaultdict

from .config import ADMIN0_URL, ADMIN1_URL, COUNTRY_META, ZONING_LAYERS, log
from .fetchers import _signed_area, fetch_arcgis_layer, fix_admin, iso3_from_text
from .helpers import digits_only, first_valid, norm_text, trunc

_M_PER_DEG_LAT = 110574.0

def _ring_bbox(rings):
    xs = [p[0] for r in rings for p in r]; ys = [p[1] for r in rings for p in r]
    return min(xs), min(ys), max(xs), max(ys)

def _point_in_ring(x, y, ring):
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y):
            xint = (xj - xi) * (y - yi) / ((yj - yi) or 1e-300) + xi
            if x < xint:
                inside = not inside
        j = i
    return inside

def _point_in_rings(x, y, rings):
    return sum(1 for r in rings if _point_in_ring(x, y, r)) % 2 == 1

def _planar_area_m2(rings):
    total = 0.0
    for r in rings:
        lat0 = sum(p[1] for p in r) / len(r)
        kx = _M_PER_DEG_LAT * math.cos(math.radians(lat0))
        s = 0.0
        for i in range(len(r) - 1):
            x1, y1 = r[i][0] * kx, r[i][1] * _M_PER_DEG_LAT
            x2, y2 = r[i + 1][0] * kx, r[i + 1][1] * _M_PER_DEG_LAT
            s += x1 * y2 - x2 * y1
        total += s / 2.0
    return abs(total)

def _ring_centroid(r):
    a = cx = cy = 0.0
    for i in range(len(r) - 1):
        cross = r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]
        a += cross; cx += (r[i][0] + r[i + 1][0]) * cross; cy += (r[i][1] + r[i + 1][1]) * cross
    if abs(a) < 1e-12:
        return sum(p[0] for p in r) / len(r), sum(p[1] for p in r) / len(r)
    return cx / (3 * a), cy / (3 * a)

def _label_point_py(rings):
    big = max(rings, key=lambda r: abs(_signed_area(r)))
    cx, cy = _ring_centroid(big)
    if _point_in_rings(cx, cy, rings):
        return cx, cy
    xs = []
    n = len(big)
    for i in range(n - 1):
        x1, y1, x2, y2 = big[i][0], big[i][1], big[i + 1][0], big[i + 1][1]
        if (y1 > cy) != (y2 > cy):
            xs.append(x1 + (cy - y1) * (x2 - x1) / ((y2 - y1) or 1e-300))
    xs.sort()
    best, best_len = None, -1
    for i in range(0, len(xs) - 1, 2):
        if xs[i + 1] - xs[i] > best_len:
            best, best_len = (xs[i] + xs[i + 1]) / 2, xs[i + 1] - xs[i]
    return (best, cy) if best is not None else (cx, cy)

class Geom:
    """Geometry helpers (pure python; the notebook's arcpy geodesic path is gone)."""

    @staticmethod
    def area_ha(g):
        if not g or not g.get("rings"):
            return None
        return round(_planar_area_m2(g["rings"]) / 10000.0, 2)

    @staticmethod
    def label_point(g):
        if not g or not g.get("rings"):
            return None, None
        x, y = _label_point_py(g["rings"])
        return round(x, 6), round(y, 6)

class SpatialLookup:
    """Point-in-polygon lookup against CAFI admin0 / admin1 (pure python with bbox prefilter)."""
    def __init__(self):
        self.admin0, self.admin1, self.ok = [], [], False

    def load(self):
        try:
            f0, _ = fetch_arcgis_layer(ADMIN0_URL, out_fields="admin0name,admin0pcod")
            f1, _ = fetch_arcgis_layer(ADMIN1_URL, out_fields="admin1name,admin0name,admin1pcod")
        except Exception as e:
            log(f"Admin layers unavailable, province/country checks disabled: {e}", "WARN")
            return self
        for f in f0:
            g = f.get("geometry") or {}
            if g.get("rings"):
                self.admin0.append((_ring_bbox(g["rings"]), g["rings"], f["attributes"].get("admin0name"),
                                    iso3_from_text(f["attributes"].get("admin0name"))))
        for f in f1:
            g = f.get("geometry") or {}
            if g.get("rings"):
                self.admin1.append((_ring_bbox(g["rings"]), g["rings"], f["attributes"].get("admin1name"),
                                    iso3_from_text(f["attributes"].get("admin0name"))))
        self.ok = bool(self.admin0)
        log(f"Spatial lookup: {len(self.admin0)} countries, {len(self.admin1)} provinces")
        return self

    @staticmethod
    def _find(items, x, y):
        for bbox, rings, name, iso3 in items:
            if bbox[0] <= x <= bbox[2] and bbox[1] <= y <= bbox[3] and _point_in_rings(x, y, rings):
                return name, iso3
        return None, None

    def country(self, x, y):
        return self._find(self.admin0, x, y) if (self.ok and x is not None) else (None, None)

    def province(self, x, y):
        return self._find(self.admin1, x, y) if (self.ok and x is not None) else (None, None)

def classify_situation(layer, rec):
    has = lambda k: rec.get(k) not in (None, "", "unknown")
    area = has("area_sig_ha") or has("area_calc_ha")
    if layer in ZONING_LAYERS:
        typed = rec.get("zone_type_std") not in (None, "unclassified", "other")
        if typed and has("parent_uid"):
            return "complete"
        if typed or has("parent_uid") or has("zone_name"):
            return "part_complete"
        return "no_data"
    if layer == "local_territories":
        if has("name") and has("province") and has("admin2") and area:
            return "complete"
        return "part_complete" if has("name") else "no_data"
    core = has("name") and has("sub_type_std")
    if core and area and has("province") and has("status_std"):
        return "complete"
    if has("name") and (area or has("province") or has("status_std") or has("holder")):
        return "part_complete"
    return "no_data"

def enrich(layer, rec, geom, lookup, stats, reassign_country=False):
    if not geom:
        rec["situation"] = classify_situation(layer, rec)
        return rec
    rec["area_calc_ha"] = Geom.area_ha(geom)
    x, y = Geom.label_point(geom)
    rec["centroid_x"], rec["centroid_y"] = x, y
    if lookup.ok and x is not None:
        cname, ciso = lookup.country(x, y)
        if ciso is None:
            rec["country_check"] = "outside"
        elif ciso == rec["iso3"]:
            rec["country_check"] = "ok"
        elif reassign_country:
            rec["iso3"], rec["country"] = ciso, COUNTRY_META[ciso][0]
            rec["src_uid"] = ciso + rec["src_uid"][rec["src_uid"].index(":"):]
            rec["country_check"] = "ok"
        else:
            rec["country_check"] = "mismatch"
            stats["country_mismatch"] += 1
        if not first_valid(rec.get("province")):
            pname, piso = lookup.province(x, y)
            if pname and (piso == rec["iso3"] or piso is None):
                rec["province"] = trunc(fix_admin(pname) or pname, 120)
                stats["province_computed"] += 1
    rec["situation"] = classify_situation(layer, rec)
    return rec

# ---- parent linking ---------------------------------------------------------------------
def _index_parents(parents, pfield, scope):
    scoped, unscoped, digits, compact = defaultdict(list), defaultdict(list), defaultdict(list), defaultdict(list)
    for p in parents:
        v = p.get(pfield)
        if not first_valid(v):
            continue
        key = norm_text(v)
        if scope:
            scoped[(norm_text(p.get(scope)), key)].append(p["src_uid"])
        unscoped[key].append(p["src_uid"])
        compact[key.replace(" ", "")].append(p["src_uid"])
        dg = digits_only(v)
        if len(dg) >= 3:
            digits[dg].append(p["src_uid"])
    return scoped, unscoped, digits, compact

def _spatial_parent(c, parents_by_uid, parent_geoms, bboxes):
    x, y = c.get("centroid_x"), c.get("centroid_y")
    if x is None or y is None:
        return None
    best, best_area = None, None
    for uid, bbox in bboxes.items():
        if not (bbox[0] <= x <= bbox[2] and bbox[1] <= y <= bbox[3]):
            continue
        g = parent_geoms.get(uid)
        if g and _point_in_rings(x, y, g["rings"]):
            area = parents_by_uid[uid].get("area_calc_ha") or 0
            if best is None or area < best_area:
                best, best_area = uid, area
    return best

def attach_parents(children, parents, rule, stats, unmatched_out, parent_geoms=None):
    """Set parent_uid on children.
    rule = dict(child_field, parent_field, alt_child_field, alt_parent_field, scope)  scope in (None, "province", "admin2").
    Order: scoped exact match -> unscoped exact match if unique -> compact/digits match if unique -> spatial containment."""
    if not parents:
        unmatched_out.extend(children)
        stats["parent_unmatched"] += len(children)
        return
    parents_by_uid = {p["src_uid"]: p for p in parents}
    bboxes = {}
    if parent_geoms:
        for uid in parents_by_uid:
            g = parent_geoms.get(uid)
            if g and g.get("rings"):
                bboxes[uid] = _ring_bbox(g["rings"])
    scope = rule.get("scope")
    attempts = []
    for cf in (rule.get("child_field"), rule.get("alt_child_field")):
        for pf in (rule.get("parent_field"), rule.get("alt_parent_field")):
            if cf and pf and (cf, pf) not in attempts:
                attempts.append((cf, pf))
    indexes = {pf: _index_parents(parents, pf, scope) for _, pf in attempts}
    matched = 0
    for c in children:
        hit = None
        for cf, pf in attempts:
            v = c.get(cf)
            if not first_valid(v):
                continue
            scoped, unscoped, digits, compact = indexes[pf]
            key = norm_text(v)
            cands = scoped.get((norm_text(c.get(scope)), key)) if scope and first_valid(c.get(scope)) else None
            if not cands:
                u = unscoped.get(key)
                if u and len(set(u)) == 1:
                    cands = u
                elif u and not scope:
                    cands = u
                    stats["parent_ambiguous"] += 1
            if not cands:
                u = compact.get(key.replace(" ", ""))
                if u and len(set(u)) == 1:
                    cands = u
            if not cands and len(digits_only(v)) >= 3:
                dg = digits.get(digits_only(v))
                if dg and len(set(dg)) == 1:
                    cands = dg
            if cands:
                hit = cands[0]
                break
        if not hit and bboxes:
            hit = _spatial_parent(c, parents_by_uid, parent_geoms, bboxes)
            if hit:
                stats["parent_spatial"] += 1
        if hit:
            c["parent_uid"] = hit
            c["parent_name"] = parents_by_uid[hit].get("name") if hit in parents_by_uid else None
            matched += 1
        else:
            unmatched_out.append(c)
    stats["parent_matched"] += matched
    stats["parent_unmatched"] += len(children) - matched

def dedup_fallbacks(layer, items, specs, stats_all, uid_alias):
    """items: list of (rec, geom, spec). Fallback-role records matching a primary record are dropped (dedup_of set)."""
    primary = [(r, g, s) for r, g, s in items if s.get("role", "primary") == "primary"]
    fallback = [(r, g, s) for r, g, s in items if s.get("role") == "fallback"]
    if not fallback or not primary:
        return items, []
    by_full, by_name = defaultdict(list), defaultdict(list)
    for r, _, _ in primary:
        for v in (r.get("name"), r.get("community"), r.get("reference"), r.get("link_key")):
            k = norm_text(v)
            if len(k) < 3:
                continue
            by_name[(r["iso3"], k)].append(r["src_uid"])
            by_full[(r["iso3"], k, norm_text(r.get("admin2")))].append(r["src_uid"])
    keep, dropped = list(primary), []
    for r, g, s in fallback:
        hit = None
        for v in (r.get("reference"), r.get("name"), r.get("community"), r.get("link_key")):
            k = norm_text(v)
            if len(k) < 3:
                continue
            cands = by_full.get((r["iso3"], k, norm_text(r.get("admin2")))) or (by_name.get((r["iso3"], k)) if not r.get("admin2") else None)
            if not cands:
                cands = by_name.get((r["iso3"], k)) if len(set(by_name.get((r["iso3"], k), []))) == 1 else None
            if cands:
                hit = cands[0]
                break
        if hit:
            r["dedup_of"] = hit
            uid_alias[r["src_uid"]] = hit
            dropped.append((r, g, s))
            stats_all[(layer, r["iso3"])]["dedup_dropped"] += 1
        else:
            keep.append((r, g, s))
    return keep, dropped
