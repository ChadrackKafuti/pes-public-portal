import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import maplibregl from "maplibre-gl";
import type { MapGeoJSONFeature } from "maplibre-gl";
import type { Feature, FeatureCollection, Point, Polygon } from "geojson";
import type { GovLayerInfo, GovLayerKey, Locale } from "@cafi/shared";
import { api } from "../api/client";
import { BASEMAPS, type BasemapId } from "./basemaps";
import {
  GOV_LAYER_ORDER,
  GOV_ZONING_LAYERS,
  ZONE_TYPES,
  govFillColor,
  govLayerLabel,
  zoneTypeLabel,
} from "./governance";
import { fmtDate, fmtNum, useI18n, useT } from "../i18n";

/** Congo Basin extent used by portal-v1 (WGS84). */
const CONGO_BASIN: [[number, number], [number, number]] = [
  [5, -14],
  [32, 12],
];

const SRC = "parcels";
const LAYERS = ["parcels-fill", "parcels-line", "parcels-point"] as const;

/** Status palette (app.css tokens as literals — MapLibre can't read CSS vars);
 *  unprocessed parcels keep the series hue. Shown with text labels in the
 *  map legend, never color alone. */
export const PARCEL_STATUS_COLORS: Record<string, string> = {
  ok: "#0ca30c",
  partial: "#fab219",
  partial_final: "#d03b3b",
};
const PARCEL_DEFAULT_COLOR = "#3987e5";

function statusColor(): unknown {
  const expr: unknown[] = ["match", ["coalesce", ["get", "status"], ""]];
  for (const [k, v] of Object.entries(PARCEL_STATUS_COLORS)) expr.push(k, v);
  expr.push(PARCEL_DEFAULT_COLOR);
  return expr;
}

function addParcelLayers(map: maplibregl.Map, data: FeatureCollection) {
  map.addSource(SRC, { type: "geojson", data });
  map.addLayer({
    id: "parcels-fill",
    type: "fill",
    source: SRC,
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: { "fill-color": statusColor() as never, "fill-opacity": 0.3 },
  });
  map.addLayer({
    id: "parcels-line",
    type: "line",
    source: SRC,
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: { "line-color": statusColor() as never, "line-width": 2 },
  });
  map.addLayer({
    id: "parcels-point",
    type: "circle",
    source: SRC,
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      "circle-radius": 6,
      "circle-color": statusColor() as never,
      "circle-stroke-width": 2,
      "circle-stroke-color": "#ffffff",
    },
  });
}

function dataBounds(data: FeatureCollection): maplibregl.LngLatBounds | null {
  const b = new maplibregl.LngLatBounds();
  let any = false;
  const walk = (coords: unknown): void => {
    if (typeof (coords as number[])[0] === "number") {
      b.extend(coords as [number, number]);
      any = true;
    } else {
      (coords as unknown[]).forEach(walk);
    }
  };
  for (const f of data.features) {
    walk((f.geometry as Point | Polygon).coordinates);
  }
  return any ? b : null;
}

const govSrc = (key: GovLayerKey) => `gov-${key}`;
const govFill = (key: GovLayerKey) => `gov-${key}-fill`;
const govLine = (key: GovLayerKey) => `gov-${key}-line`;

function addGovLayers(map: maplibregl.Map, key: GovLayerKey, data: FeatureCollection) {
  if (map.getSource(govSrc(key))) return;
  map.addSource(govSrc(key), { type: "geojson", data });
  // Governance polygons sit beneath the PES parcels so parcels stay clickable.
  const before = map.getLayer("parcels-fill") ? "parcels-fill" : undefined;
  map.addLayer(
    {
      id: govFill(key),
      type: "fill",
      source: govSrc(key),
      paint: {
        "fill-color": govFillColor(key) as never,
        "fill-opacity": GOV_ZONING_LAYERS.includes(key) ? 0.55 : 0.35,
      },
    },
    before,
  );
  map.addLayer(
    {
      id: govLine(key),
      type: "line",
      source: govSrc(key),
      paint: { "line-color": "#4b4b4b", "line-width": 0.6 },
    },
    before,
  );
}

/** Popup body for one governance feature (portal-v1 Arcade popup, condensed). */
function govPopupContent(
  key: GovLayerKey,
  p: Record<string, unknown>,
  locale: Locale,
  docsLabel: string,
): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "map-popup";
  const esc = (v: unknown) =>
    String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const row = (label: string, v: unknown) =>
    v === null || v === undefined || v === "" ? "" : `<tr><td>${label}</td><td>${esc(v)}</td></tr>`;
  const zoning = GOV_ZONING_LAYERS.includes(key);
  const title = p.name ?? p.zoneName ?? p.reference ?? p.srcUid;
  const area = typeof p.areaCalcHa === "number" ? `${fmtNum(p.areaCalcHa, locale, 0)} ha` : null;
  el.innerHTML = `
    <strong>${esc(title)}</strong>
    <span class="muted small"> — ${esc(govLayerLabel(key, locale))}</span>
    <table class="popup-rows">
      ${zoning ? row(locale === "fr" ? "Affectation" : "Zoning class", zoneTypeLabel(p.zoneTypeStd as string, locale)) : ""}
      ${zoning ? row(locale === "fr" ? "Unité parente" : "Parent unit", p.parentName) : ""}
      ${row(locale === "fr" ? "Référence" : "Reference", p.reference)}
      ${row(locale === "fr" ? "Type" : "Type", p.designation ?? p.subTypeRaw ?? p.subTypeStd)}
      ${row(locale === "fr" ? "Attributaire" : "Holder", p.holder)}
      ${row(locale === "fr" ? "Exploitant" : "Operator", p.operator)}
      ${row(locale === "fr" ? "Communauté" : "Community", p.community)}
      ${row(locale === "fr" ? "Statut" : "Status", p.statusStd)}
      ${row("IUCN", p.iucnCategory)}
      ${row(locale === "fr" ? "Localisation" : "Location", [p.admin2, p.province, p.country].filter(Boolean).join(", "))}
      ${row(locale === "fr" ? "Superficie" : "Area", area)}
      ${row(locale === "fr" ? "Attribution" : "Attributed", p.dateAttr ? fmtDate(p.dateAttr as string, locale) : null)}
    </table>`;
  if (typeof p.wdpaUrl === "string") {
    const a = document.createElement("a");
    a.href = p.wdpaUrl;
    a.target = "_blank";
    a.rel = "noreferrer";
    a.textContent = "Protected Planet";
    el.appendChild(a);
  }
  if (typeof p.docCount === "number" && p.docCount > 0 && typeof p.srcUid === "string") {
    const docs = document.createElement("div");
    docs.className = "popup-docs";
    docs.textContent = `${docsLabel}…`;
    el.appendChild(docs);
    api
      .governanceDocuments(p.srcUid)
      .then((rows) => {
        docs.innerHTML = `<span class="muted small">${docsLabel}</span>`;
        for (const d of rows) {
          if (!d.url) continue;
          const a = document.createElement("a");
          a.href = d.url;
          a.target = "_blank";
          a.rel = "noreferrer";
          a.textContent = d.title ?? d.fileName ?? d.docUid;
          docs.appendChild(a);
        }
      })
      .catch(() => {
        docs.textContent = "";
      });
  }
  return el;
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
  const [govOpen, setGovOpen] = useState(false);
  const [govInfo, setGovInfo] = useState<GovLayerInfo[] | null>(null);
  const [govVisible, setGovVisible] = useState<Partial<Record<GovLayerKey, boolean>>>({});
  const [govOpacity, setGovOpacity] = useState(1);
  const govDataRef = useRef<Partial<Record<GovLayerKey, FeatureCollection>>>({});
  const govVisibleRef = useRef(govVisible);
  govVisibleRef.current = govVisible;

  const zoomToData = () => {
    const map = mapRef.current;
    const data = dataRef.current;
    if (!map) return;
    const b = data ? dataBounds(data) : null;
    if (b) {
      map.fitBounds(b, { padding: 80, maxZoom: 12 });
    } else {
      map.fitBounds(CONGO_BASIN, { padding: 24 });
    }
  };

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
        const data = (await api.applicationsGeojson()) as FeatureCollection;
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
    // Governance overlays: cursor + popup (parcels win when both are hit).
    const govFillIds = GOV_LAYER_ORDER.map((k) => govFill(k));
    map.on("mousemove", (e) => {
      const ids = govFillIds.filter((id) => map.getLayer(id));
      if (!ids.length) return;
      const hits = map.queryRenderedFeatures(e.point, { layers: ids });
      if (hits.length) map.getCanvas().style.cursor = "pointer";
    });
    map.on("click", (e) => {
      const parcelIds = LAYERS.filter((id) => map.getLayer(id));
      if (parcelIds.length && map.queryRenderedFeatures(e.point, { layers: [...parcelIds] }).length) {
        return; // the parcels handler below owns this click
      }
      const ids = govFillIds.filter((id) => map.getLayer(id));
      if (!ids.length) return;
      const hit = map.queryRenderedFeatures(e.point, { layers: ids })[0];
      if (!hit) return;
      const key = hit.layer.id.slice(4, -5) as GovLayerKey; // gov-<key>-fill
      const el = govPopupContent(key, hit.properties ?? {}, localeRef.current, t("gov_documents"));
      new maplibregl.Popup({ closeButton: true, maxWidth: "300px" })
        .setLngLat(e.lngLat)
        .setDOMContent(el)
        .addTo(map);
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
      for (const key of GOV_LAYER_ORDER) {
        const data = govDataRef.current[key];
        if (data && govVisibleRef.current[key] && !map.getSource(govSrc(key))) {
          addGovLayers(map, key, data);
        }
      }
    });
  }, [basemap]);

  // Governance layer toggles: lazy-load each layer once, then flip visibility.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;
    for (const key of GOV_LAYER_ORDER) {
      const on = !!govVisible[key];
      if (on && !govDataRef.current[key]) {
        api
          .governanceGeojson(key)
          .then((data) => {
            govDataRef.current[key] = data;
            const m = mapRef.current;
            if (!cancelled && m && govVisibleRef.current[key]) addGovLayers(m, key, data);
          })
          .catch(() => {
            /* ingest not run yet or API down: leave the toggle inert */
          });
      } else if (map.getLayer(govFill(key))) {
        const vis = on ? "visible" : "none";
        map.setLayoutProperty(govFill(key), "visibility", vis);
        map.setLayoutProperty(govLine(key), "visibility", vis);
      } else if (on && govDataRef.current[key]) {
        addGovLayers(map, key, govDataRef.current[key]!);
      }
    }
    return () => {
      cancelled = true;
    };
  }, [govVisible]);

  // Layer inventory, fetched the first time the panel opens.
  useEffect(() => {
    if (govOpen && govInfo === null) {
      api.governanceLayers().then(setGovInfo).catch(() => setGovInfo([]));
    }
  }, [govOpen, govInfo]);

  // Governance overlay opacity: scale each layer's base fill opacity.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const key of GOV_LAYER_ORDER) {
      if (!map.getLayer(govFill(key))) continue;
      const base = GOV_ZONING_LAYERS.includes(key) ? 0.55 : 0.35;
      map.setPaintProperty(govFill(key), "fill-opacity", base * govOpacity);
      map.setPaintProperty(govLine(key), "line-opacity", Math.min(1, 0.4 + 0.6 * govOpacity));
    }
  }, [govOpacity, govVisible]);

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
        <button className="lang" onClick={() => setGovOpen(!govOpen)}>
          {t("gov_layers")}
        </button>
        <button className="lang" onClick={zoomToData}>
          {t("map_zoom_data")}
        </button>
      </div>
      <div className="map-legend">
        <span className="gov-legend-row">
          <i style={{ background: "#3987e5" }} /> {t("legend_not_processed")}
        </span>
        {Object.entries(PARCEL_STATUS_COLORS).map(([k, c]) => (
          <span key={k} className="gov-legend-row">
            <i style={{ background: c }} /> {k}
          </span>
        ))}
      </div>
      {govOpen && (
        <div className="gov-panel">
          <strong>{t("gov_layers")}</strong>
          {GOV_LAYER_ORDER.map((key) => {
            const info = govInfo?.find((i) => i.layer === key);
            return (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={!!govVisible[key]}
                  onChange={(e) => setGovVisible({ ...govVisible, [key]: e.target.checked })}
                />
                {govLayerLabel(key, locale)}
                {info ? <span className="muted small"> ({info.total})</span> : null}
              </label>
            );
          })}
          <label className="gov-opacity">
            <span className="muted small">{t("gov_opacity")}</span>
            <input
              id="gov-opacity"
              type="range"
              min="10"
              max="100"
              value={Math.round(govOpacity * 100)}
              onChange={(e) => setGovOpacity(Number(e.target.value) / 100)}
            />
          </label>
          {GOV_ZONING_LAYERS.some((k) => govVisible[k]) && (
            <div className="gov-legend">
              <span className="muted small">{t("gov_zone_legend")}</span>
              {Object.entries(ZONE_TYPES).map(([k, z]) => (
                <span key={k} className="gov-legend-row">
                  <i style={{ background: z.color }} /> {z[locale]}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
