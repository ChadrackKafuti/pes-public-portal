"""Fetcher tests: geometry conversion, paging, and the pure-python
shapefile readers (synthetic .shp/.dbf built in-test)."""

import struct

import cb_governance.fetchers as fetchers
from cb_governance.fetchers import (
    SrcFeature,
    _read_dbf,
    _read_shp_polygons,
    fetch_arcgis_layer,
    fetch_source_local,
    geojson_to_esri_rings,
)
from cb_governance.store import esri_rings_to_geojson

SQUARE = [[0.0, 0.0], [0.0, 1.0], [1.0, 1.0], [1.0, 0.0], [0.0, 0.0]]  # counter-clockwise
HOLE = [[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75], [0.25, 0.25]]  # clockwise


def test_geojson_to_esri_rings_orients_rings():
    g = geojson_to_esri_rings({"type": "Polygon", "coordinates": [SQUARE, HOLE]})
    rings = g["rings"]
    assert len(rings) == 2
    # outer ring clockwise (positive signed area), hole counter-clockwise
    assert fetchers._signed_area(rings[0]) > 0
    assert fetchers._signed_area(rings[1]) < 0


def test_esri_rings_roundtrip_to_geojson():
    esri = geojson_to_esri_rings({"type": "Polygon", "coordinates": [SQUARE, HOLE]})
    gj = esri_rings_to_geojson(esri)
    assert gj["type"] == "Polygon"
    assert len(gj["coordinates"]) == 2  # outer + hole reunited


def test_esri_rings_multipolygon():
    far = [[[10, 10], [10, 11], [11, 11], [11, 10], [10, 10]]]
    esri = geojson_to_esri_rings({"type": "MultiPolygon", "coordinates": [[SQUARE], far]})
    gj = esri_rings_to_geojson(esri)
    assert gj["type"] == "MultiPolygon"
    assert len(gj["coordinates"]) == 2


def test_fetch_arcgis_layer_pages_with_result_offset(monkeypatch):
    calls = []
    meta = {
        "maxRecordCount": 2,
        "objectIdField": "OBJECTID",
        "advancedQueryCapabilities": {"supportsPagination": True},
        "fields": [],
    }
    pages = [
        {"features": [{"attributes": {"OBJECTID": 1}}, {"attributes": {"OBJECTID": 2}}], "exceededTransferLimit": True},
        {"features": [{"attributes": {"OBJECTID": 3}}], "exceededTransferLimit": False},
    ]

    def fake_get_json(url, params=None, method="GET"):
        if url.endswith("/query"):
            calls.append(params["resultOffset"])
            return pages[len(calls) - 1]
        return meta

    monkeypatch.setattr(fetchers, "get_json", fake_get_json)
    fetchers._meta_cache.clear()
    feats, m = fetch_arcgis_layer("https://example/FeatureServer/0")
    assert [f["attributes"]["OBJECTID"] for f in feats] == [1, 2, 3]
    assert calls == [0, 2]


def _write_test_shapefile(base):
    """One polygon record (type 5) + matching dbf with one text and one numeric field."""
    ring = SQUARE
    num_points = len(ring)
    content = struct.pack("<i", 5)
    content += struct.pack("<4d", 0, 0, 1, 1)
    content += struct.pack("<ii", 1, num_points)
    content += struct.pack("<i", 0)
    for x, y in ring:
        content += struct.pack("<2d", x, y)
    rec = struct.pack(">II", 1, len(content) // 2) + content
    header = struct.pack(">7i", 9994, 0, 0, 0, 0, 0, (100 + len(rec)) // 2)
    header += struct.pack("<2i", 1000, 5) + struct.pack("<8d", 0, 0, 1, 1, 0, 0, 0, 0)
    (base.parent / (base.name + ".shp")).write_bytes(header + rec)

    fields = [("Terroir", "C", 20, 0), ("Area_ha", "N", 10, 2)]
    fdefs = b""
    rl = 1
    for name, typ, ln, dec in fields:
        fdefs += name.encode().ljust(11, b"\0") + typ.encode() + b"\0" * 4 + bytes([ln, dec]) + b"\0" * 14
        rl += ln
    hl = 32 + len(fdefs) + 1
    dbf = struct.pack("<B3BIHH20x", 3, 24, 1, 1, 1, hl, rl) + fdefs + b"\x0d"
    dbf += b" " + b"Bolobo".ljust(20) + b"     12.50"
    (base.parent / (base.name + ".dbf")).write_bytes(dbf)


def test_local_shapefile_reader(tmp_path):
    base = tmp_path / "PSAT_TEST"
    _write_test_shapefile(base)
    rows = _read_dbf(str(base) + ".dbf")
    assert rows[0][1]["Terroir"] == "Bolobo"
    assert rows[0][1]["Area_ha"] == 12.5
    geoms = _read_shp_polygons(str(base) + ".shp")
    assert geoms[0]["rings"][0][0] == [0.0, 0.0]

    spec = {"iso3": "COD", "layer_key": "psat_lim", "kind": "local_shp", "path": str(base) + ".shp"}
    feats, meta = fetch_source_local("local_territories", spec)
    assert len(feats) == 1
    assert isinstance(feats[0], SrcFeature)
    assert feats[0].attrs["Terroir"] == "Bolobo"
    assert feats[0].geom["rings"]
