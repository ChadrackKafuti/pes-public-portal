"""Earth Engine backend — spec §2.2 datasets and §11 formulas.

Requires the `compute` extra (earthengine-api) and a service-account
credential; everything above this module is testable without it.
Imagery never leaves GEE — only aggregated numbers are returned (spec §2.2).
"""

import json
from datetime import date, timedelta

from ..config import PipelineConfig
from ..geometry import buffer_radius_m
from ..models import GeomSource, PesObject
from ..windows import Interval
from .common import date_to_serial, m2_to_ha, tc_window_ladder

DYNAMIC_WORLD = "GOOGLE/DYNAMICWORLD/V1"
VIIRS_SNPP = "NASA/LANCE/SNPP_VIIRS/C2"
VIIRS_NOAA20 = "NASA/LANCE/NOAA20_VIIRS/C2"
MODIS_BURNED = "MODIS/061/MCD64A1"


def _iso(d: date) -> str:
    return d.isoformat()


class GeeBackend:
    """IndicatorBackend over the Earth Engine Python API."""

    def __init__(self, config: PipelineConfig):
        import ee  # deferred: heavy, and absent outside the compute image

        import os

        from ..gee_auth import materialise_gee_credentials

        materialise_gee_credentials(config.gee_service_account)
        self._ee = ee
        self._config = config
        self._mask_cache: dict[tuple[int, date], tuple[object, float, int] | None] = {}
        key_file = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        if key_file:
            # ServiceAccountCredentials needs the key file explicitly;
            # key_data=None raises inside the client library. The email may
            # come from the env or from the key JSON itself.
            with open(key_file) as fh:
                email = config.gee_service_account or json.load(fh).get("client_email")
            ee.Initialize(ee.ServiceAccountCredentials(email, key_file))
        else:
            try:
                ee.Initialize()  # ADC (Cloud Run workload identity)
            except ee.EEException as exc:
                raise RuntimeError(
                    "No Earth Engine credentials: set CAFI_RS_GEE_KEY_B64 "
                    "(service-account JSON key) and CAFI_RS_GEE_SERVICE_ACCOUNT, "
                    "or run with Application Default Credentials"
                ) from exc

    # -- geometry ---------------------------------------------------------

    def resolve_parcel(self, bearer: PesObject, source: GeomSource):
        ee = self._ee
        if source in (GeomSource.POLYGON, GeomSource.POLYGON_INHERITED):
            assert bearer.shape_wkt is not None
            return ee.Geometry(self._shape_to_geojson(bearer.shape_wkt), None, True)
        assert bearer.point is not None and bearer.estimated_area_ha is not None
        lon, lat = bearer.point
        radius = buffer_radius_m(bearer.estimated_area_ha)  # spec §11.8
        return ee.Geometry.Point([lon, lat]).buffer(radius)

    @staticmethod
    def _shape_to_geojson(shape: str) -> dict:
        """The PES API Shape is WKT or JSON polygon in WGS84 (spec §10).

        Malformed geometry raises, which the caller records as an exception
        row rather than processing (spec §10).
        """
        s = shape.strip()
        if s.startswith("{"):
            return json.loads(s)
        from shapely import from_wkt
        from shapely.geometry import mapping

        return mapping(from_wkt(s))

    def parcel_area_ha(self, parcel) -> float:
        # Geodesic area (spec §6.1, glossary).
        return m2_to_ha(parcel.area(maxError=1).getInfo())

    # -- Dynamic World tree cover (spec §11.2) ----------------------------

    def _tree_mask(self, parcel, at: date, window_days: int):
        """mean(trees probability over [at - W, at]) >= prob_threshold."""
        ee = self._ee
        col = (
            ee.ImageCollection(DYNAMIC_WORLD)
            .filterBounds(parcel)
            .filterDate(_iso(at - timedelta(days=window_days)), _iso(at + timedelta(days=1)))
            .select("trees")
        )
        return col.mean().gte(self._config.prob_threshold), col

    def _coverage(self, col, parcel) -> float:
        """Fraction of the parcel observed by the collection.

        An empty collection produces band-less images whose comparisons
        throw in EE, so it is answered directly as zero coverage — this is
        what lets the tree-cover window ladder widen past cloudy periods.
        """
        if int(col.size().getInfo()) == 0:
            return 0.0
        observed = col.count().gt(0)
        stats = observed.unmask(0).reduceRegion(
            reducer=self._ee.Reducer.mean(), geometry=parcel, scale=10, maxPixels=1e10
        )
        return float(stats.get("trees").getInfo() or 0.0)

    def _tree_mask_adaptive(self, parcel, at: date) -> tuple[object, float, int] | None:
        """Walk the widening ladder; return (mask, coverage, window_days) for
        the first rung reaching min_coverage_frac, else the widest rung with
        any imagery; None when no window has imagery at all.

        Memoised per (parcel, date): tree_cover and tree_cover_loss resolve
        the same object-date mask (for applications the loss interval ends at
        object_date), and each ladder walk costs several getInfo round trips
        — measured ~33% of per-object time in the confirmation run.
        """
        key = (id(parcel), at)
        if key in self._mask_cache:
            return self._mask_cache[key]
        ladder = tc_window_ladder(self._config.tc_window_days)
        best: tuple[object, float, int] | None = None
        for candidate in ladder:
            mask, col = self._tree_mask(parcel, at, candidate)
            coverage = self._coverage(col, parcel)
            if coverage > 0.0:
                best = (mask, coverage, candidate)
            if coverage >= self._config.min_coverage_frac:
                break
        if len(self._mask_cache) > 64:  # a handful of dates per object
            self._mask_cache.clear()
        self._mask_cache[key] = best
        return best

    def tree_cover(self, parcel, at: date) -> tuple[float, int, float]:
        """Shortest window on the ladder reaching min_coverage_frac wins."""
        best = self._tree_mask_adaptive(parcel, at)
        if best is None:  # no Dynamic World imagery in any window
            ladder = tc_window_ladder(self._config.tc_window_days)
            raise RuntimeError(f"no Dynamic World imagery within {ladder[-1]} days of {at}")
        mask, coverage, window_days = best
        ha = self._mask_area_ha(mask.selfMask(), parcel, scale=10)
        return ha, window_days, coverage

    def tree_cover_loss(self, parcel, interval: Interval) -> float:
        """loss(A, B) = area(tree(A) AND NOT tree(B)) — spec §11.3.

        Both endpoint masks use the same widening ladder as tree_cover: a
        fixed 7-day window at a years-old baseline date is rarely populated
        (validated live — every parcel needed the 60-day rung)."""
        start = self._tree_mask_adaptive(parcel, interval.start)
        if start is None or start[1] < self._config.min_coverage_frac:
            # Spec §11.3: blank when imagery near the start date is unavailable.
            raise RuntimeError("insufficient Dynamic World coverage at interval start")
        end = self._tree_mask_adaptive(parcel, interval.end)
        if end is None:
            raise RuntimeError("no Dynamic World imagery at interval end")
        tree_a, tree_b = start[0], end[0]
        return self._mask_area_ha(tree_a.And(tree_b.Not()).selfMask(), parcel, scale=10)

    # -- Dynamic World dominant land cover (M7d) --------------------------

    DW_CLASSES = [
        "water", "trees", "grass", "flooded_vegetation", "crops",
        "shrub_and_scrub", "built", "bare", "snow_and_ice",
    ]

    def dominant_landcover(self, parcel, at: date) -> tuple[str, float]:
        """The parcel's modal Dynamic World class near a date, with its share
        of the parcel (%). Walks the same widening window ladder as
        tree_cover so cloudy periods resolve."""
        ee = self._ee
        for window in tc_window_ladder(self._config.tc_window_days):
            col = (
                ee.ImageCollection(DYNAMIC_WORLD)
                .filterBounds(parcel)
                .filterDate(_iso(at - timedelta(days=window)), _iso(at + timedelta(days=1)))
                .select("label")
            )
            if int(col.size().getInfo()) == 0:
                continue
            mode = col.reduce(ee.Reducer.mode())
            hist = (
                mode.reduceRegion(
                    reducer=ee.Reducer.frequencyHistogram(),
                    geometry=parcel,
                    scale=10,
                    maxPixels=1e10,
                )
                .get("label_mode")
                .getInfo()
                or {}
            )
            if not hist:
                continue
            total = sum(hist.values())
            top_key, top_n = max(hist.items(), key=lambda kv: kv[1])
            idx = int(float(top_key))
            name = self.DW_CLASSES[idx] if 0 <= idx < len(self.DW_CLASSES) else str(idx)
            return name, round(top_n / total * 100, 1)
        raise RuntimeError(f"no Dynamic World imagery near {at}")

    # -- 1 m canopy height (M25) ------------------------------------------

    def canopy_metrics(self, parcel) -> tuple[float, float]:
        """(mean canopy height m, % of parcel with canopy > 3 m) from the
        Meta/WRI 1 m global canopy height model — sees the scattered or
        young trees that 10 m Dynamic World misses on small parcels.
        Sampled at 10 m: the point is parcel-level shares, not single trees."""
        ee = self._ee
        img = ee.ImageCollection(self._config.canopy_asset).mosaic()
        band = img.bandNames().get(0)
        height = img.select([band])
        mean = height.reduceRegion(
            reducer=ee.Reducer.mean(), geometry=parcel, scale=10, maxPixels=1e10
        )
        mean_m = float(list(mean.getInfo().values())[0] or 0.0)
        over3_ha = self._mask_area_ha(height.gt(3).selfMask(), parcel, scale=10)
        area_ha = self.parcel_area_ha(parcel)
        pct = round(min(100.0, over3_ha / area_ha * 100), 1) if area_ha else 0.0
        return round(mean_m, 2), pct

    # -- counterfactual control (M25) -------------------------------------

    def control_tree_cover(self, parcel, at: date) -> float | None:
        """Tree-cover FRACTION (0..1) of the annulus around the parcel — the
        matched 'surrounding landscape' control the additionality story
        compares against. None when no imagery reaches the annulus."""
        annulus = parcel.buffer(self._config.control_outer_m).difference(
            parcel.buffer(self._config.control_inner_m)
        )
        best = self._tree_mask_adaptive(annulus, at)
        if best is None:
            return None
        mask, _coverage, _window = best
        tc_ha = self._mask_area_ha(mask.selfMask(), annulus, scale=10)
        area_ha = self.parcel_area_ha(annulus)
        return round(tc_ha / area_ha, 4) if area_ha else None

    # -- Sentinel-2 monthly NDVI (M29b) -----------------------------------

    def annulus(self, parcel):
        """The 'surrounding landscape' control ring used across M25/M29b."""
        return parcel.buffer(self._config.control_outer_m).difference(
            parcel.buffer(self._config.control_inner_m)
        )

    @staticmethod
    def _s2_clear(img):
        """Mask clouds/shadows/snow via the scene classification band."""
        scl = img.select("SCL")
        bad = (
            scl.eq(3).Or(scl.eq(8)).Or(scl.eq(9)).Or(scl.eq(10)).Or(scl.eq(11))
        )
        return img.updateMask(bad.Not())

    def ndvi_series(self, geom, months: list) -> dict:
        """{month iso: mean NDVI or None} for the given month starts — one
        getInfo round trip for the whole list (server-side mapping)."""
        ee = self._ee

        def monthly(m):
            s = ee.Date(m)
            col = (
                ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
                .filterBounds(geom)
                .filterDate(s, s.advance(1, "month"))
                .map(self._s2_clear)
            )
            ndvi = ee.Image(
                ee.Algorithms.If(
                    col.size().gt(0),
                    col.median().normalizedDifference(["B8", "B4"]).rename("ndvi"),
                    ee.Image.constant(-9999).rename("ndvi"),
                )
            )
            val = ndvi.reduceRegion(
                reducer=ee.Reducer.mean(), geometry=geom, scale=20, maxPixels=1e10
            ).get("ndvi")
            return ee.Feature(None, {"m": s.format("YYYY-MM-dd"), "v": val})

        fc = ee.FeatureCollection(
            ee.List([m.isoformat() for m in months]).map(monthly)
        )
        out: dict = {}
        for f in fc.getInfo().get("features", []):
            p = f.get("properties", {})
            v = p.get("v")
            out[p.get("m")] = (
                round(float(v), 4) if v is not None and float(v) > -1 else None
            )
        return out

    # -- fragmentation (M29b) ---------------------------------------------

    def fragmentation(self, parcel, at: date) -> tuple[int, float] | None:
        """(patch count, edge metres per ha) of the tree mask near a date.
        Edge length is approximated as boundary-pixel count × pixel size."""
        ee = self._ee
        best = self._tree_mask_adaptive(parcel, at)
        if best is None:
            return None
        mask, _cov, _win = best
        mask = mask.selfMask()
        labels = mask.connectedComponents(ee.Kernel.plus(1), 1024).select("labels")
        patches = labels.reduceRegion(
            reducer=ee.Reducer.countDistinct(), geometry=parcel, scale=10,
            maxPixels=1e10,
        )
        n = int(list(patches.getInfo().values())[0] or 0)
        interior = mask.unmask(0).focalMin(1, "plus")
        edge = mask.unmask(0).And(interior.Not())
        edge_px = self._pixel_count(edge.selfMask(), parcel, scale=10)
        area_ha = self.parcel_area_ha(parcel)
        per_ha = round(edge_px * 10.0 / area_ha, 1) if area_ha else 0.0
        return n, per_ha

    # -- RADD alerts (spec §11.4) -----------------------------------------

    def radd_alerts(self, parcel, interval: Interval) -> int:
        ee = self._ee
        img = (
            ee.ImageCollection(self._config.radd_asset)
            .filterMetadata("layer", "contains", "alert")
            .filterBounds(parcel)
            .mosaic()
        )
        # Raster stores yyDDD; decode to yyyyDDD (indicators.common.radd_decode).
        serial = img.select("Date").divide(1000).floor().add(2000).multiply(1000).add(
            img.select("Date").mod(1000)
        )
        in_window = serial.gte(date_to_serial(interval.start)).And(
            serial.lte(date_to_serial(interval.end))
        )
        confident = img.select("Alert").gte(self._config.radd_min_confidence)
        return self._pixel_count(in_window.And(confident).selfMask(), parcel, scale=10)

    # -- VIIRS fire alerts (spec §11.5) -----------------------------------

    def fire_alerts(self, parcel, interval: Interval) -> int:
        total = 0
        for dataset in (VIIRS_SNPP, VIIRS_NOAA20):
            col = (
                self._ee.ImageCollection(dataset)
                .filterBounds(parcel)
                .filterDate(_iso(interval.start), _iso(interval.end + timedelta(days=1)))
                .select("Bright_ti4")
            )
            presence = col.map(lambda img: img.gt(0)).sum()
            total += self._pixel_count(presence.selfMask(), parcel, scale=375, sum_values=True)
        return total

    # -- MODIS burned area (spec §11.6) -----------------------------------

    def burned_area_ha(self, parcel, interval: Interval) -> float:
        col = (
            self._ee.ImageCollection(MODIS_BURNED)
            .filterBounds(parcel)
            .filterDate(_iso(interval.start), _iso(interval.end + timedelta(days=1)))
            .select("BurnDate")
        )
        burned = col.max().gt(0)
        return self._mask_area_ha(burned.selfMask(), parcel, scale=500)

    # -- reducers (spec §11.1) --------------------------------------------

    def _mask_area_ha(self, mask, parcel, *, scale: int) -> float:
        ee = self._ee
        stats = mask.multiply(ee.Image.pixelArea()).reduceRegion(
            reducer=ee.Reducer.sum(), geometry=parcel, scale=scale, maxPixels=1e10
        )
        value = list(stats.getInfo().values())[0] or 0.0
        return m2_to_ha(float(value))

    def _pixel_count(self, mask, parcel, *, scale: int, sum_values: bool = False) -> int:
        ee = self._ee
        reducer = ee.Reducer.sum() if sum_values else ee.Reducer.count()
        stats = mask.reduceRegion(
            reducer=reducer, geometry=parcel, scale=scale, maxPixels=1e10
        )
        value = list(stats.getInfo().values())[0] or 0
        return int(value)
