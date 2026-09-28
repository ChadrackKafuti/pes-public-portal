"""HTTP client and source fetchers (notebook §3).

Ported verbatim minus the arcpy branch of fetch_source_local: the
pure-Python .shp/.dbf readers are always used here.
"""

import datetime as _dt
import json
import os
import re
import struct
import threading
import time
from dataclasses import dataclass

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .config import (
    ADMIN_FIXES,
    COUNTRY_ALIASES,
    HTTP_TIMEOUT,
    LOCAL_DATA_DIR,
    WDPA_MARINE,
    WDPA_TOKEN,
    log,
)
from .helpers import (
    first_valid,
    norm_text,
    parse_date_any,
    parse_num,
)


def fix_admin(v):
    s = first_valid(v)
    if s is None:
        return None
    key = norm_text(s)
    if key in ADMIN_FIXES:
        return ADMIN_FIXES[key]
    return s.strip().title() if s.isupper() else s.strip()

def iso3_from_text(v, default=None):
    n = norm_text(v)
    if not n:
        return default
    for iso3, aliases in COUNTRY_ALIASES.items():
        for a in aliases:
            if n == a or re.search(r"\b" + re.escape(a) + r"\b", n):
                return iso3
    return default

# ---- HTTP ---------------------------------------------------------------------
_session = None
_session_lock = threading.Lock()

def http():
    global _session
    with _session_lock:
        if _session is None:
            s = requests.Session()
            retry = Retry(total=5, backoff_factor=1.5, status_forcelist=[429, 500, 502, 503, 504], allowed_methods=["GET", "POST"])
            s.mount("https://", HTTPAdapter(max_retries=retry, pool_maxsize=20))
            s.mount("http://", HTTPAdapter(max_retries=retry, pool_maxsize=20))
            s.headers["User-Agent"] = "CAFI-cb_forest_ingest/1.0 (+UNDP CAFI spatial reporting)"
            _session = s
        return _session

def get_json(url, params=None, method="GET", timeout=None):
    params = dict(params or {})
    params.setdefault("f", "json")
    r = http().request(method, url, params=params if method == "GET" else None,
                       data=params if method != "GET" else None, timeout=timeout or HTTP_TIMEOUT)
    r.raise_for_status()
    try:
        d = r.json()
    except ValueError:
        raise RuntimeError(f"Non-JSON response from {url}: {r.text[:200]}")
    if isinstance(d, dict) and "error" in d:
        raise RuntimeError(f"ArcGIS error {d['error'].get('code')} at {url}: {d['error'].get('message')} {d['error'].get('details')}")
    return d

# ---- data model ----------------------------------------------------------------
@dataclass
class SrcFeature:
    layer: str
    iso3: str
    layer_key: str
    oid: object
    globalid: object
    attrs: dict
    geom: dict            # esri polygon json {"rings": [...]} or None
    src_url: str
    last_edit: object = None
    src_file: str = None
    part_index: int = 0

# ---- ArcGIS REST layers (AGOL FeatureServer and Server MapServer) ---------------
_meta_cache = {}

def layer_meta(url):
    if url not in _meta_cache:
        _meta_cache[url] = get_json(url)
    return _meta_cache[url]

def domain_maps(meta):
    out = {}
    for f in meta.get("fields", []) or []:
        dom = f.get("domain")
        if dom and dom.get("codedValues"):
            out[f["name"]] = {str(c["code"]): c["name"] for c in dom["codedValues"]}
    return out

def layer_last_edit(meta):
    ei = meta.get("editingInfo") or {}
    return ei.get("dataLastEditDate") or ei.get("lastEditDate")

def fetch_arcgis_layer(url, where="1=1", out_fields="*", geometry=True, out_sr=4326):
    """All features of a FeatureServer/MapServer layer, paged. Returns (features, meta)."""
    meta = layer_meta(url)
    max_rec = int(meta.get("maxRecordCount") or 1000)
    max_rec = min(max_rec, 2000)
    supports_paging = bool((meta.get("advancedQueryCapabilities") or {}).get("supportsPagination"))
    base = {"where": where, "outFields": out_fields, "returnGeometry": "true" if geometry else "false",
            "outSR": out_sr, "f": "json"}
    feats = []
    if supports_paging:
        offset = 0
        while True:
            d = get_json(url + "/query", dict(base, resultOffset=offset, resultRecordCount=max_rec))
            chunk = d.get("features", [])
            feats.extend(chunk)
            if not d.get("exceededTransferLimit") or not chunk:
                break
            offset += len(chunk)
    else:
        ids = get_json(url + "/query", {"where": where, "returnIdsOnly": "true"}).get("objectIds") or []
        oid_field = meta.get("objectIdField") or "OBJECTID"
        for i in range(0, len(ids), max_rec):
            chunk_ids = ",".join(map(str, ids[i:i + max_rec]))
            d = get_json(url + "/query", dict(base, where="1=1", objectIds=chunk_ids), method="POST")
            feats.extend(d.get("features", []))
    return feats, meta

def _oid_of(attrs, meta):
    oid_field = meta.get("objectIdField") or "OBJECTID"
    for k in (oid_field, "OBJECTID", "objectid", "FID", "fid", "objectid_1", "OBJECTID_1"):
        if k in attrs and attrs[k] is not None:
            return attrs[k]
    return None

def _gid_of(attrs, meta):
    gf = meta.get("globalIdField")
    for k in ([gf] if gf else []) + ["globalid", "GlobalID", "GLOBALID", "globalid_2", "GlobalID_2"]:
        if k and k in attrs and attrs[k]:
            return str(attrs[k]).strip("{}").lower()
    return None

def fetch_source_arcgis(layer, spec, url=None):
    url = url or spec["url"]
    feats, meta = fetch_arcgis_layer(url)
    last_edit = layer_last_edit(meta)
    out = []
    for f in feats:
        a = f.get("attributes") or {}
        g = f.get("geometry")
        if g and not g.get("rings"):
            g = None
        iso3 = spec["iso3"]
        if iso3 == "*":
            iso3 = iso3_from_text(a.get("pays") or a.get("PAYS") or a.get("country"), None) or "COD"
        out.append(SrcFeature(layer, iso3, spec["layer_key"], _oid_of(a, meta), _gid_of(a, meta), a, g, url, last_edit))
    return out, meta

# ---- geocfcl.org JSON API ------------------------------------------------------------
def _signed_area(ring):
    s = 0.0
    for i in range(len(ring) - 1):
        x1, y1 = ring[i][0], ring[i][1]
        x2, y2 = ring[i + 1][0], ring[i + 1][1]
        s += (x2 - x1) * (y2 + y1)
    return s / 2.0     # > 0 => clockwise (esri outer ring)

def _close_ring(ring):
    ring = [[float(p[0]), float(p[1])] for p in ring]
    if ring and ring[0] != ring[-1]:
        ring.append(list(ring[0]))
    return ring

def geojson_to_esri_rings(geom):
    """GeoJSON Polygon/MultiPolygon -> esri rings (outer clockwise, holes counter-clockwise)."""
    if not geom:
        return None
    gtype, coords = geom.get("type"), geom.get("coordinates")
    polys = coords if gtype == "MultiPolygon" else [coords] if gtype == "Polygon" else []
    rings = []
    for poly in polys:
        for i, ring in enumerate(poly):
            r = _close_ring(ring)
            if len(r) < 4:
                continue
            cw = _signed_area(r) > 0
            if (i == 0 and not cw) or (i > 0 and cw):
                r.reverse()
            rings.append(r)
    return {"rings": rings, "spatialReference": {"wkid": 4326}} if rings else None

def fetch_source_geocfcl(layer, spec):
    url = spec["url"]
    r = http().get(url, timeout=HTTP_TIMEOUT)
    r.raise_for_status()
    apps = r.json()
    if isinstance(apps, dict):
        apps = apps.get("results") or apps.get("features") or []
    out = []
    for app in apps:
        attrs = {k: v for k, v in app.items() if k != "locations"}
        feats = (app.get("locations") or {}).get("features") or []
        geom = None
        if feats:
            merged = {"rings": []}
            for f in feats:
                g = geojson_to_esri_rings(f.get("geometry"))
                if g:
                    merged["rings"].extend(g["rings"])
            attrs["_n_parts"] = len(feats)
            attrs["_overlaps"] = any((f.get("properties") or {}).get("overlaps") for f in feats)
            geom = merged if merged["rings"] else None
        out.append(SrcFeature(layer, spec["iso3"], spec["layer_key"], app.get("id"), None, attrs, geom, url,
                              parse_date_any(app.get("modified"))))
    return out, {"name": "geocfcl applications", "fields": []}

# ---- Protected Planet (WDPA) API v4 ----------------------------------------------------------------
def fetch_source_wdpa(layer, spec):
    if not WDPA_TOKEN:
        raise RuntimeError("WDPA_TOKEN is empty: request a token at https://api.protectedplanet.net/request and set WDPA_TOKEN (or --wdpa-token)")
    iso3 = spec["iso3"]
    out, page = [], 1
    while True:
        params = {"token": WDPA_TOKEN, "country": iso3, "with_geometry": "true", "page": page, "per_page": 50}
        if WDPA_MARINE is not None:
            params["marine"] = "true" if WDPA_MARINE else "false"
        r = http().get(f"{spec['url']}/v4/protected_areas/search", params=params, timeout=HTTP_TIMEOUT)
        if r.status_code == 401:
            raise RuntimeError("Protected Planet API: invalid or expired token")
        r.raise_for_status()
        items = r.json().get("protected_areas", []) or []
        for pa in items:
            gj = (pa.get("geojson") or {}).get("geometry") or pa.get("geojson") or {}
            geom = geojson_to_esri_rings(gj) if gj.get("type") in ("Polygon", "MultiPolygon") else None
            attrs = {k: v for k, v in pa.items() if k != "geojson"}
            attrs["_geometry_type"] = gj.get("type")
            oid = pa.get("wdpa_id") or pa.get("id")
            out.append(SrcFeature(layer, iso3, spec["layer_key"], oid, None, attrs, geom, f"{spec['url']}/v4/protected_areas/search?country={iso3}",
                                  parse_date_any(pa.get("legal_status_updated_at"))))
        if len(items) < 50:
            break
        page += 1
        time.sleep(0.4)
    return out, {"name": "Protected Planet / WDPA", "fields": []}

# ---- local shapefiles ------------------------------------------------------------------
def _read_dbf(path):
    cpg = None
    cpg_path = os.path.splitext(path)[0] + ".cpg"
    if os.path.exists(cpg_path):
        try:
            cpg = open(cpg_path, "r", encoding="ascii", errors="ignore").read().strip() or None
        except OSError:
            cpg = None
    enc = (cpg or "utf-8").lower().replace("utf8", "utf-8")
    with open(path, "rb") as f:
        hdr = f.read(32)
        n = struct.unpack("<I", hdr[4:8])[0]
        hl = struct.unpack("<H", hdr[8:10])[0]
        rl = struct.unpack("<H", hdr[10:12])[0]
        fields = []
        while True:
            b = f.read(32)
            if not b or b[0] == 0x0D:
                break
            fields.append((b[:11].split(b"\0")[0].decode("latin1"), chr(b[11]), b[16], b[17]))
        f.seek(hl)
        rows = []
        for _ in range(n):
            r = f.read(rl)
            if not r:
                break
            deleted = r[0:1] == b"*"
            pos, rec = 1, {}
            for name, typ, ln, dec in fields:
                raw = r[pos:pos + ln]; pos += ln
                try:
                    s = raw.decode(enc)
                except (UnicodeDecodeError, LookupError):
                    s = raw.decode("latin1")
                s = s.strip("\0 ").strip()
                if typ in ("N", "F"):
                    rec[name] = parse_num(s) if s else None
                    if rec[name] is not None and dec == 0 and typ == "N":
                        rec[name] = int(rec[name])
                elif typ == "L":
                    rec[name] = True if s.upper() in ("T", "Y", "1") else False if s.upper() in ("F", "N", "0") else None
                elif typ == "D":
                    rec[name] = parse_date_any(s) if s else None
                else:
                    rec[name] = s if s else None
            rows.append((deleted, rec))
    return rows

def _read_shp_polygons(path):
    """Minimal shapefile reader for polygon types (5, 15, 25). Returns list of esri geometry dicts (or None)."""
    geoms = []
    with open(path, "rb") as f:
        data = f.read()
    pos = 100
    n = len(data)
    while pos + 8 <= n:
        rec_len_words = struct.unpack(">I", data[pos + 4:pos + 8])[0]
        start = pos + 8
        end = start + rec_len_words * 2
        stype = struct.unpack("<i", data[start:start + 4])[0]
        if stype in (5, 15, 25):
            p = start + 4 + 32
            num_parts, num_points = struct.unpack("<ii", data[p:p + 8]); p += 8
            parts = list(struct.unpack("<" + "i" * num_parts, data[p:p + 4 * num_parts])); p += 4 * num_parts
            pts = struct.unpack("<" + "d" * (2 * num_points), data[p:p + 16 * num_points])
            rings = []
            for i, s in enumerate(parts):
                e = parts[i + 1] if i + 1 < len(parts) else num_points
                ring = [[pts[2 * j], pts[2 * j + 1]] for j in range(s, e)]
                if len(ring) >= 4:
                    rings.append(ring)
            geoms.append({"rings": rings, "spatialReference": {"wkid": 4326}} if rings else None)
        else:
            geoms.append(None)
        pos = end
    return geoms

def fetch_source_local(layer, spec):
    path = spec["path"] if os.path.isabs(spec["path"]) else os.path.join(LOCAL_DATA_DIR, spec["path"])
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    out = []
    fname = os.path.basename(path)
    rows = _read_dbf(os.path.splitext(path)[0] + ".dbf")
    geoms = _read_shp_polygons(path)
    for i, ((deleted, attrs), geom) in enumerate(zip(rows, geoms)):
        if deleted:
            continue
        out.append(SrcFeature(layer, spec["iso3"], spec["layer_key"], i, None, attrs, geom, path, None, fname))
    mtime = int(os.path.getmtime(path) * 1000)
    for s in out:
        s.last_edit = mtime
    return out, {"name": fname, "fields": []}

def fetch_source(layer, spec):
    """Dispatch. Returns (spec, features, meta, error)."""
    kind = spec.get("kind")
    try:
        if kind == "agol" or kind == "mapserver":
            feats, meta = fetch_source_arcgis(layer, spec)
        elif kind == "agol_multi":
            feats, meta = [], {"name": spec["layer_key"], "fields": []}
            for u in spec["urls"]:
                try:
                    f2, m2 = fetch_source_arcgis(layer, spec, url=u)
                    feats.extend(f2)
                    if m2.get("fields"):
                        meta = dict(m2, name=spec["layer_key"])
                except Exception as e:
                    log(f"  sub-source failed {u}: {e}", "WARN")
        elif kind == "geocfcl":
            feats, meta = fetch_source_geocfcl(layer, spec)
        elif kind == "wdpa":
            feats, meta = fetch_source_wdpa(layer, spec)
        elif kind == "local_shp":
            feats, meta = fetch_source_local(layer, spec)
        else:
            return spec, [], {}, None
        return spec, feats, meta, None
    except Exception as e:
        return spec, [], {}, f"{type(e).__name__}: {e}"
