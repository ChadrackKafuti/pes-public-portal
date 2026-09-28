import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import maplibregl from "maplibre-gl";
import type { MapGeoJSONFeature } from "maplibre-gl";
import type { Feature, FeatureCollection, Point, Polygon } from "geojson";
import { BASEMAPS, type BasemapId } from "./basemaps";
import { fmtDate, useI18n, useT } from "../i18n";

/** Congo Basin extent used by portal-v1 (WGS84). */
const CONGO_BASIN: [[number, number], [number, number]] = [
  [5, -14],
  [32, 12],
];

const SRC = "parcels";
const LAYERS = ["parcels-fill", "parcels-line", "parcels-point"] as const;

function addParcelLayers(map: maplibregl.Map, data: FeatureCollection) {
  map.addSource(SRC, { type: "geojson", data });
  map.addLayer({
    id: "parcels-fill",
    type: "fill",
    source: SRC,
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: { "fill-color": "#3987e5", "fill-opacity": 0.25 },
  });
  map.addLayer({
    id: "parcels-line",
    type: "line",
    source: SRC,
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: { "line-color": "#3987e5", "line-width": 2 },
  });
  map.addLayer({
    id: "parcels-point",
    type: "circle",
    source: SRC,
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      "circle-radius": 6,
      "circle-color": "#3987e5",
      "circle-stroke-width": 2,
      "circle-stroke-color": "#ffffff",
    },
  });
}

function featureBounds(f: Feature): maplibregl.LngLatBounds {
  const b = new maplibregl.LngLatBounds();
  const walk = (coords: unknown): void => {
    if (typeof (coords as number[])[0] === "number") {
      b.extend(coords as [number, number]);
    } else {
      (coords as unknown[]).forEach(walk);
    }
  };
  walk((f.geometry as Point | Polygon).coordinates);
  return b;
}

/**
 * The single shared map. Parcels come from the API's GeoJSON endpoint —
 * the frontend never talks to upstream GIS services directly.
 */
export function MapStage() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const dataRef = useRef<FeatureCollection | null>(null);
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const t = useT();
  const locale = useI18n((s) => s.locale);
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const [basemap, setBasemap] = useState<BasemapId>("streets");
  const [query, setQuery] = useState("");
  const [miss, setMiss] = useState(false);

  useEffect(() => {
    if (!container.current) return;
    const map = new maplibregl.Map({
      container: container.current,
      style: BASEMAPS.streets,
      bounds: CONGO_BASIN,
      fitBoundsOptions: { padding: 24 },
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }));
    map.addControl(new maplibregl.ScaleControl());

    map.on("load", async () => {
      try {
        const r = await fetch("/api/applications.geojson");
        if (!r.ok) return;
        const data = (await r.json()) as FeatureCollection;
        dataRef.current = data;
        addParcelLayers(map, data);
      } catch {
        /* API down: basemap-only map is still useful */
      }
    });

    const interactive = [...LAYERS];
    map.on("mousemove", interactive, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", interactive, () => {
      map.getCanvas().style.cursor = "";
    });
    map.on("click", interactive, (e) => {
      const f: MapGeoJSONFeature | undefined = e.features?.[0];
      if (!f) return;
      const p = f.properties as Record<string, string | null>;
      const el = document.createElement("div");
      el.className = "map-popup";
      el.innerHTML = `
        <strong>${p.applicationCode ?? p.applicationId}</strong><br/>
        ${p.contractCode ? `${p.contractCode}<br/>` : ""}
        ${p.pesActivity ?? ""} · ${p.applicationDate ? fmtDate(p.applicationDate, localeRef.current) : ""}
        ${p.status ? `<br/>status: ${p.status}` : ""}`;
      const btn = document.createElement("button");
      btn.className = "map-popup-btn";
      btn.textContent = t("open_dossier");
      btn.onclick = () =>
        navigateRef.current(`/applications/${encodeURIComponent(p.applicationId as string)}`);
      el.appendChild(document.createElement("br"));
      el.appendChild(btn);
      new maplibregl.Popup({ closeButton: true, maxWidth: "260px" })
        .setLngLat(e.lngLat)
        .setDOMContent(el)
        .addTo(map);
    });

    return () => {
      mapRef.current = null;
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Basemap switch: setStyle drops our layers; re-add them afterwards.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(BASEMAPS[basemap]);
    map.once("styledata", () => {
      if (dataRef.current && !map.getSource(SRC)) {
        addParcelLayers(map, dataRef.current);
      }
    });
  }, [basemap]);

  // Find on map: client-side match on the loaded features.
  useEffect(() => {
    if (!query) {
      setMiss(false);
      return;
    }
    const handle = setTimeout(() => {
      const map = mapRef.current;
      const data = dataRef.current;
      if (!map || !data) return;
      const q = query.trim().toUpperCase();
      const hit = data.features.find((f: Feature) => {
        const p = f.properties as Record<string, string | null>;
        return [p.applicationId, p.applicationCode, p.contractCode].some(
          (v) => v && v.toUpperCase().includes(q),
        );
      });
      setMiss(!hit);
      if (hit) {
        map.fitBounds(featureBounds(hit), { padding: 80, maxZoom: 15 });
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  return (
    <div className="map-wrap">
      <div ref={container} className="map-stage" />
      <div className="map-overlay">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("map_find_placeholder")}
          aria-label={t("map_find_placeholder")}
        />
        {miss && <span className="map-miss">{t("map_no_match")}</span>}
        <button
          className="lang"
          onClick={() => setBasemap(basemap === "streets" ? "imagery" : "streets")}
        >
          {basemap === "streets" ? t("basemap_imagery") : t("basemap_streets")}
        </button>
      </div>
    </div>
  );
}
