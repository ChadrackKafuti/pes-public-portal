import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import maplibregl from "maplibre-gl";
import type { MapGeoJSONFeature } from "maplibre-gl";
import type { Feature, FeatureCollection, Point, Polygon } from "geojson";
import type { AoiResult, GovLayerInfo, GovLayerKey, Locale } from "@cafi/shared";
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
import { GovInspector } from "./GovInspector";

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

/** M3 AOI draw tool: click-to-vertex, double-click to close. Hand-rolled —
 *  a full draw library is overkill for one polygon. */
const AOI_SRC = "aoi";
const AOI_COLOR = "#3987e5";

function aoiCollection(verts: [number, number][], closed: boolean): FeatureCollection {
  const features: Feature[] = verts.map((v) => ({
    type: "Feature",
    properties: {},
    geometry: { type: "Point", coordinates: v },
  }));
  if (closed && verts.length >= 3) {
    features.push({
      type: "Feature",
      properties: {},
      geometry: { type: "Polygon", coordinates: [[...verts, verts[0]]] },
    });
  } else if (verts.length >= 2) {
    features.push({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: verts },
    });
  }
  return { type: "FeatureCollection", features };
}

function setAoiLayers(map: maplibregl.Map, data: FeatureCollection) {
  const src = map.getSource(AOI_SRC) as maplibregl.GeoJSONSource | undefined;
  if (src) {
    src.setData(data);
    return;
  }
  map.addSource(AOI_SRC, { type: "geojson", data });
  map.addLayer({
    id: "aoi-fill",
    type: "fill",
    source: AOI_SRC,
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: { "fill-color": AOI_COLOR, "fill-opacity": 0.12 },
  });
  map.addLayer({
    id: "aoi-line",
    type: "line",
    source: AOI_SRC,
    filter: ["!=", ["geometry-type"], "Point"],
    paint: { "line-color": AOI_COLOR, "line-width": 2, "line-dasharray": [2, 1.5] },
  });
  map.addLayer({
    id: "aoi-vertex",
    type: "circle",
    source: AOI_SRC,
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      "circle-radius": 4,
      "circle-color": AOI_COLOR,
      "circle-stroke-width": 1.5,
      "circle-stroke-color": "#ffffff",
    },
  });
}

/* Sidebar section icons (stroke style, 24px viewBox). */
const MS_ICONS: Record<string, ReactNode> = {
  analysis: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M7 4 4 7l5 5-5 5 3 3 5-5 5 5 3-3-5-5 5-5-3-3-5 5-5-5Z" strokeLinejoin="round" />
    </svg>
  ),
  layers: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" strokeLinejoin="round" />
      <path d="m3 13 9 5 9-5" strokeLinejoin="round" />
    </svg>
  ),
  find: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5" strokeLinecap="round" />
    </svg>
  ),
  filters: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M3 5h18l-7 8v6l-4-2v-4L3 5Z" strokeLinejoin="round" />
    </svg>
  ),
  basemap: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c3 3.5 3 14 0 18-3-4-3-14.5 0-18Z" />
    </svg>
  ),
  overview: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="3" width="8" height="5" rx="1.5" />
      <rect x="13" y="10" width="8" height="11" rx="1.5" />
      <rect x="3" y="13" width="8" height="8" rx="1.5" />
    </svg>
  ),
  panelClose: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16M16 10l-2.5 2L16 14" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  panelOpen: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16M13.5 10l2.5 2-2.5 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

/** Photo points (M7a): neutral violet, never a status hue. */
const PHOTO_COLOR = "#7e57c2";

function addPhotoLayer(map: maplibregl.Map, data: FeatureCollection) {
  if (map.getSource("photos")) return;
  map.addSource("photos", { type: "geojson", data });
  map.addLayer({
    id: "photos-dots",
    type: "circle",
    source: "photos",
    paint: {
      "circle-radius": 5,
      "circle-color": PHOTO_COLOR,
      "circle-stroke-width": 1.5,
      "circle-stroke-color": "#ffffff",
    },
  });
}

/** Popup body for one photo point: label + parent link + lazy signed image. */
function photoPopupContent(
  p: Record<string, unknown>,
  pendingLabel: string,
  navigateToDossier: (id: string) => void,
): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "map-popup";
  const title = document.createElement("strong");
  title.textContent = String(p.label ?? "Photo");
  el.appendChild(title);
  if (typeof p.applicationId === "string" && p.applicationId) {
    const btn = document.createElement("button");
    btn.className = "map-popup-btn";
    btn.textContent = p.applicationCode ? String(p.applicationCode) : p.applicationId;
    btn.onclick = () => navigateToDossier(p.applicationId as string);
    el.appendChild(document.createElement("br"));
    el.appendChild(btn);
  }
  const slot = document.createElement("div");
  slot.className = "popup-photo";
  el.appendChild(slot);
  if (p.mirrored && typeof p.photoUid === "string") {
    slot.textContent = "…";
    api
      .photoImageUrl(p.photoUid)
      .then(({ url }) => {
        slot.textContent = "";
        const img = document.createElement("img");
        img.src = url;
        img.alt = String(p.label ?? "Photo");
        slot.appendChild(img);
      })
      .catch(() => {
        slot.textContent = pendingLabel;
      });
  } else {
    slot.textContent = pendingLabel;
    slot.className += " muted small";
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
 * The single shared map (v1 pattern: mounted once by the shell and kept
 * alive; the Map route shows the panel, Analyses only the map behind its
 * own overlay). Parcels come from the API's GeoJSON endpoint — the
 * frontend never talks to upstream GIS services directly.
 */
export function MapStage({
  showPanel = true,
  visible = true,
}: {
  showPanel?: boolean;
  visible?: boolean;
}) {
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
  const [sideOpen, setSideOpen] = useState(true);
  const [tab, setTab] = useState<"overview" | "filters" | "layers">("overview");
  const [basemapOpen, setBasemapOpen] = useState(false);
  const [govInfo, setGovInfo] = useState<GovLayerInfo[] | null>(null);
  const [govVisible, setGovVisible] = useState<Partial<Record<GovLayerKey, boolean>>>({});
  const [govOpacity, setGovOpacity] = useState(1);
  const govDataRef = useRef<Partial<Record<GovLayerKey, FeatureCollection>>>({});
  const govVisibleRef = useRef(govVisible);
  govVisibleRef.current = govVisible;

  const [inspect, setInspect] = useState<{
    srcUid: string;
    layer: GovLayerKey;
    seed: Record<string, unknown>;
  } | null>(null);
  const openInspectorRef = useRef((srcUid: string, layer: GovLayerKey, seed: Record<string, unknown>) => {
    setInspect({ srcUid, layer, seed });
    setSideOpen(true);
    setTab("overview"); // v1: selecting a feature jumps to Overview
  });

  /* M7e — client-side parcel filters (v1 §7): draft → Apply/Reset semantics. */
  const emptyFlt = {
    country: "", province: "", org: "", project: "", activity: "",
    beneficiaryType: "", gender: "", applicationStatus: "",
    code: "", from: "", to: "",
  };
  const [flt, setFlt] = useState(emptyFlt);
  const [fltCount, setFltCount] = useState<number | null>(null);
  const filteredRef = useRef<FeatureCollection | null>(null);
  const [dataVersion, setDataVersion] = useState(0);

  const fltMatch = (p: Record<string, unknown>, f: typeof emptyFlt): boolean => {
    const selects: [keyof typeof emptyFlt, string][] = [
      ["country", "country"], ["province", "province"], ["org", "org"],
      ["project", "project"], ["activity", "pesActivity"],
      ["beneficiaryType", "beneficiaryType"], ["gender", "gender"],
      ["applicationStatus", "applicationStatus"],
    ];
    for (const [k, prop] of selects) {
      if (f[k] && String(p[prop] ?? "") !== f[k]) return false;
    }
    if (f.code) {
      const q = f.code.toUpperCase();
      const hit = ["applicationId", "applicationCode", "contractCode"].some(
        (k) => typeof p[k] === "string" && (p[k] as string).toUpperCase().includes(q),
      );
      if (!hit) return false;
    }
    const d = typeof p.applicationDate === "string" ? p.applicationDate.slice(0, 10) : "";
    if (f.from && (!d || d < f.from)) return false;
    if (f.to && (!d || d > f.to)) return false;
    return true;
  };

  const applyFlt = (f: typeof emptyFlt) => {
    const map = mapRef.current;
    const data = dataRef.current;
    if (!map || !data) return;
    const active = Object.values(f).some((v) => v !== "");
    const filtered: FeatureCollection = active
      ? {
          type: "FeatureCollection",
          features: data.features.filter((ft) =>
            fltMatch((ft.properties ?? {}) as Record<string, unknown>, f),
          ),
        }
      : data;
    filteredRef.current = active ? filtered : null;
    (map.getSource(SRC) as maplibregl.GeoJSONSource | undefined)?.setData(filtered);
    setFltCount(active ? filtered.features.length : null);
  };

  /** Distinct sorted values of one geojson property, optionally pre-filtered. */
  const fltOptions = (prop: string, pre?: (p: Record<string, unknown>) => boolean): string[] => {
    const data = dataRef.current;
    if (!data) return [];
    const out = new Set<string>();
    for (const ft of data.features) {
      const p = (ft.properties ?? {}) as Record<string, unknown>;
      if (pre && !pre(p)) continue;
      const v = p[prop];
      if (typeof v === "string" && v) out.add(v);
    }
    return [...out].sort();
  };
  void dataVersion; // options recompute when the geojson arrives

  const [photosOn, setPhotosOn] = useState(false);
  const photosDataRef = useRef<FeatureCollection | null>(null);
  const photosOnRef = useRef(photosOn);
  photosOnRef.current = photosOn;

  const [aoiMode, setAoiMode] = useState(false);
  const aoiModeRef = useRef(aoiMode);
  aoiModeRef.current = aoiMode;
  const aoiVertsRef = useRef<[number, number][]>([]);
  const aoiClosedRef = useRef(false);
  const [aoiVerts, setAoiVertsCount] = useState(0);
  const [aoiResult, setAoiResult] = useState<AoiResult | null>(null);
  const [aoiBusy, setAoiBusy] = useState(false);
  const [aoiError, setAoiError] = useState<string | null>(null);

  const clearAoi = () => {
    aoiVertsRef.current = [];
    aoiClosedRef.current = false;
    setAoiVertsCount(0);
    setAoiResult(null);
    setAoiError(null);
    setAoiBusy(false);
    const map = mapRef.current;
    if (map) setAoiLayers(map, aoiCollection([], false));
  };

  const finishAoi = () => {
    const verts = aoiVertsRef.current;
    // a double-click also lands two single clicks: drop trailing duplicates
    while (verts.length > 1) {
      const a = verts[verts.length - 2];
      const b = verts[verts.length - 1];
      if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) verts.pop();
      else break;
    }
    if (verts.length < 3) return;
    setAoiMode(false);
    aoiClosedRef.current = true;
    const map = mapRef.current;
    if (map) setAoiLayers(map, aoiCollection(verts, true));
    setAoiBusy(true);
    const polygon: Polygon = { type: "Polygon", coordinates: [[...verts, verts[0]]] };
    api
      .aoi(polygon)
      .then((r) => {
        setAoiResult(r);
        setAoiError(null);
      })
      .catch((err: Error) => setAoiError(err.message))
      .finally(() => setAoiBusy(false));
  };
  const finishAoiRef = useRef(finishAoi);
  finishAoiRef.current = finishAoi;

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
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new maplibregl.ScaleControl());

    map.on("load", async () => {
      try {
        const data = (await api.applicationsGeojson()) as FeatureCollection;
        dataRef.current = data;
        addParcelLayers(map, data);
        setDataVersion((v) => v + 1);
      } catch {
        /* API down: basemap-only map is still useful */
      }
    });

    // AOI drawing owns the map while active; other click handlers stand down.
    map.on("click", (e) => {
      if (!aoiModeRef.current) return;
      aoiVertsRef.current.push([e.lngLat.lng, e.lngLat.lat]);
      setAoiVertsCount(aoiVertsRef.current.length);
      setAoiLayers(map, aoiCollection(aoiVertsRef.current, false));
    });
    map.on("dblclick", (e) => {
      if (!aoiModeRef.current) return;
      e.preventDefault(); // keep double-click zoom off while drawing
      finishAoiRef.current();
    });

    const interactive = [...LAYERS];
    map.on("mousemove", interactive, () => {
      if (aoiModeRef.current) return;
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", interactive, () => {
      if (aoiModeRef.current) return;
      map.getCanvas().style.cursor = "";
    });
    // Governance overlays: cursor + popup (parcels win when both are hit).
    const govFillIds = GOV_LAYER_ORDER.map((k) => govFill(k));
    map.on("mousemove", (e) => {
      if (aoiModeRef.current) return;
      const ids = govFillIds.filter((id) => map.getLayer(id));
      if (!ids.length) return;
      const hits = map.queryRenderedFeatures(e.point, { layers: ids });
      if (hits.length) map.getCanvas().style.cursor = "pointer";
    });
    // Photo points win over everything below them.
    map.on("click", "photos-dots", (e) => {
      if (aoiModeRef.current) return;
      const f: MapGeoJSONFeature | undefined = e.features?.[0];
      if (!f) return;
      const el = photoPopupContent(f.properties ?? {}, t("photo_pending"), (id) =>
        navigateRef.current(`/applications/${encodeURIComponent(id)}`),
      );
      new maplibregl.Popup({ closeButton: true, maxWidth: "300px" })
        .setLngLat(e.lngLat)
        .setDOMContent(el)
        .addTo(map);
    });
    const photoHit = (e: maplibregl.MapMouseEvent) =>
      !!map.getLayer("photos-dots") &&
      map.queryRenderedFeatures(e.point, { layers: ["photos-dots"] }).length > 0;

    map.on("click", (e) => {
      if (aoiModeRef.current || photoHit(e)) return;
      const parcelIds = LAYERS.filter((id) => map.getLayer(id));
      if (parcelIds.length && map.queryRenderedFeatures(e.point, { layers: [...parcelIds] }).length) {
        return; // the parcels handler below owns this click
      }
      const ids = govFillIds.filter((id) => map.getLayer(id));
      if (!ids.length) return;
      const hit = map.queryRenderedFeatures(e.point, { layers: ids })[0];
      if (!hit) return;
      const key = hit.layer.id.slice(4, -5) as GovLayerKey; // gov-<key>-fill
      const props = (hit.properties ?? {}) as Record<string, unknown>;
      if (typeof props.srcUid === "string") {
        // M7c: the feature inspector in the sidebar replaces the popup.
        openInspectorRef.current(props.srcUid, key, props);
      }
    });

    map.on("click", interactive, (e) => {
      if (aoiModeRef.current || photoHit(e)) return;
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
      // v1-depth mini-profile line (M7b): stage, overdue, fire, achieved %.
      const prof = document.createElement("div");
      prof.className = "muted small";
      el.appendChild(prof);
      api
        .applicationProfile(p.applicationId as string)
        .then((pr) => {
          const bits: string[] = [];
          if (pr.stage?.name) bits.push(`${t("pf_stage")}: ${pr.stage.name}`);
          if (pr.visits?.overdue) bits.push(t("pf_visit_overdue"));
          if (pr.fire?.category === "high" || pr.fire?.category === "very_high") {
            bits.push(
              `${t("pf_fire_risk")}: ${t(pr.fire.category === "high" ? "fire_high" : "fire_very_high")}`,
            );
          }
          if (pr.performance?.achievedPct != null) {
            bits.push(`${Math.round(pr.performance.achievedPct)}% ${t("perf_achieved")}`);
          }
          prof.textContent = bits.join(" · ");
        })
        .catch(() => {
          prof.remove();
        });
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
        addParcelLayers(map, filteredRef.current ?? dataRef.current);
      }
      for (const key of GOV_LAYER_ORDER) {
        const data = govDataRef.current[key];
        if (data && govVisibleRef.current[key] && !map.getSource(govSrc(key))) {
          addGovLayers(map, key, data);
        }
      }
      if (photosDataRef.current && photosOnRef.current && !map.getSource("photos")) {
        addPhotoLayer(map, photosDataRef.current);
      }
      if (aoiVertsRef.current.length) {
        setAoiLayers(map, aoiCollection(aoiVertsRef.current, aoiClosedRef.current));
      }
    });
  }, [basemap]);

  // Photo layer toggle: lazy-load once, then flip visibility.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;
    if (photosOn && !photosDataRef.current) {
      api
        .photosGeojson()
        .then((data) => {
          photosDataRef.current = data as FeatureCollection;
          const m = mapRef.current;
          if (!cancelled && m && photosOnRef.current) addPhotoLayer(m, data as FeatureCollection);
        })
        .catch(() => {
          /* photos not synced yet: leave the toggle inert */
        });
    } else if (map.getLayer("photos-dots")) {
      map.setLayoutProperty("photos-dots", "visibility", photosOn ? "visible" : "none");
    } else if (photosOn && photosDataRef.current) {
      addPhotoLayer(map, photosDataRef.current);
    }
    return () => {
      cancelled = true;
    };
  }, [photosOn]);

  // Crosshair while drawing an AOI.
  useEffect(() => {
    const map = mapRef.current;
    if (map) map.getCanvas().style.cursor = aoiMode ? "crosshair" : "";
  }, [aoiMode]);

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

  // Layer inventory, fetched the first time the Layers tab shows.
  useEffect(() => {
    if (sideOpen && tab === "layers" && govInfo === null) {
      api.governanceLayers().then(setGovInfo).catch(() => setGovInfo([]));
    }
  }, [sideOpen, tab, govInfo]);

  // Hidden while another route owns the screen: re-measure when shown again.
  // Mounted hidden (landing first), the initial fit ran on a 0-size canvas,
  // so the first reveal also re-fits the basin.
  const everShownRef = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!visible || !map) return;
    map.resize();
    if (!everShownRef.current) map.fitBounds(CONGO_BASIN, { padding: 24 });
    everShownRef.current = true;
  }, [visible]);

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

  const tabs = [
    { id: "overview" as const, label: t("tab_overview"), icon: MS_ICONS.overview },
    { id: "filters" as const, label: t("section_filters"), icon: MS_ICONS.filters },
    { id: "layers" as const, label: t("tab_layers"), icon: MS_ICONS.layers },
  ];

  return (
    <div className="map-wrap">
      <div ref={container} className="map-stage" />
      {showPanel && (
        <form className="code-search" role="search" onSubmit={(e) => e.preventDefault()}>
          {MS_ICONS.find}
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("map_find_placeholder")}
            aria-label={t("map_find_placeholder")}
          />
          {miss && <div className="code-search-miss">{t("map_no_match")}</div>}
        </form>
      )}
      {showPanel && !sideOpen && (
        <div className="glass panel collapsed">
          <button
            className="panel-toggle"
            onClick={() => setSideOpen(true)}
            title={t("panel_expand")}
            aria-label={t("panel_expand")}
          >
            {MS_ICONS.panelOpen}
          </button>
        </div>
      )}
      {showPanel && sideOpen && (
        <div className="glass panel">
          <button
            className="panel-toggle"
            onClick={() => setSideOpen(false)}
            title={t("panel_collapse")}
            aria-label={t("panel_collapse")}
          >
            {MS_ICONS.panelClose}
          </button>
          <div className="tablist" role="tablist">
            {tabs.map((tb) => (
              <button
                key={tb.id}
                role="tab"
                aria-selected={tab === tb.id}
                className={`tab${tab === tb.id ? " tab-active" : ""}`}
                onClick={() => setTab(tb.id)}
              >
                {tb.icon}
                <span>{tb.label}</span>
              </button>
            ))}
          </div>
          <div className="panel-body scroll">
            <div role="tabpanel" hidden={tab !== "overview"} className="tabpanel">
              {inspect ? (
                <GovInspector
                  srcUid={inspect.srcUid}
                  layer={inspect.layer}
                  seed={inspect.seed}
                  onClose={() => setInspect(null)}
                />
              ) : (
                <>
                  <p className="panel-hint">{t("overview_hint")}</p>
            <div className="step">
              <span className="step-num">1</span>
              <div className="step-body">
                <span className="step-title">{t("aoi_define")}</span>
                {!aoiMode && aoiResult === null && aoiError === null && !aoiBusy && (
                  <button
                    className="btn"
                    onClick={() => {
                      clearAoi();
                      setAoiMode(true);
                    }}
                  >
                    {t("aoi_draw")}
                  </button>
                )}
                {aoiMode && (
                  <>
                    <span className="muted small">{t("aoi_hint")}</span>
                    <div className="basemap-row">
                      {aoiVerts >= 3 && (
                        <button className="btn" onClick={finishAoi}>
                          OK
                        </button>
                      )}
                      <button
                        className="btn-ghost"
                        onClick={() => {
                          setAoiMode(false);
                          clearAoi();
                        }}
                      >
                        {t("aoi_cancel")}
                      </button>
                    </div>
                  </>
                )}
                {!aoiMode && (aoiResult !== null || aoiError !== null) && (
                  <button
                    className="btn-ghost"
                    onClick={() => {
                      clearAoi();
                      setAoiMode(true);
                    }}
                  >
                    {t("aoi_redraw")}
                  </button>
                )}
              </div>
            </div>
            <div className="step-connector" />
            <div className={`step${aoiResult !== null || aoiBusy || aoiError !== null ? "" : " step-off"}`}>
              <span className="step-num">2</span>
              <div className="step-body">
                <span className="step-title">{t("aoi_results")}</span>
                {aoiBusy && <span className="muted small">{t("loading")}</span>}
                {aoiError !== null && (
                  <span className="small">
                    {t("aoi_error")}: {aoiError}
                  </span>
                )}
                {aoiResult !== null && (
                  <>
                    <span className="aoi-stat">
                      {t("aoi_area")}: <strong>{fmtNum(aoiResult.areaHa, locale, 0)} ha</strong>
                    </span>
                    {aoiResult.overlaps.length === 0 ? (
                      <span className="muted small">{t("aoi_none")}</span>
                    ) : (
                      <>
                        {(() => {
                          const entries = Object.entries(aoiResult.byLayer) as [GovLayerKey, number][];
                          const max = Math.max(...entries.map(([, v]) => v)) || 1;
                          return entries.map(([layer, ha]) => (
                            <div className="barlist-row" key={layer}>
                              <span className="barlist-label" title={govLayerLabel(layer, locale)}>
                                {govLayerLabel(layer, locale)}
                              </span>
                              <span className="barlist-track">
                                <span
                                  className="barlist-bar"
                                  style={{ width: `${(ha / max) * 100}%` }}
                                />
                              </span>
                              <span className="barlist-value">{fmtNum(ha, locale, 0)}</span>
                            </div>
                          ));
                        })()}
                        <span className="muted small">{t("aoi_overlaps")}</span>
                        <ul className="aoi-list">
                          {aoiResult.overlaps.slice(0, 40).map((o) => (
                            <li key={o.srcUid}>
                              {o.name ?? o.reference ?? o.srcUid}
                              <span className="muted small"> — {govLayerLabel(o.layer, locale)}</span>
                              <br />
                              <span className="muted small">
                                {fmtNum(o.overlapHa, locale, 0)} ha ·{" "}
                                {fmtNum(o.overlapPct, locale, 1)}% {t("aoi_of_aoi")}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    <button className="btn-ghost" onClick={clearAoi}>
                      {t("aoi_clear")}
                    </button>
                  </>
                )}
              </div>
            </div>
                </>
              )}
            </div>

            <div role="tabpanel" hidden={tab !== "layers"} className="tabpanel">
            <span className="muted small">{t("parcels_title")}</span>
            <span className="gov-legend-row">
              <i style={{ background: PARCEL_DEFAULT_COLOR }} /> {t("legend_not_processed")}
            </span>
            {Object.entries(PARCEL_STATUS_COLORS).map(([k, c]) => (
              <span key={k} className="gov-legend-row">
                <i style={{ background: c }} /> {k}
              </span>
            ))}
            <div className="gov-layers">
              <label>
                <input
                  type="checkbox"
                  checked={photosOn}
                  onChange={(e) => setPhotosOn(e.target.checked)}
                />
                <i
                  className="legend-dot"
                  style={{ background: PHOTO_COLOR }}
                  aria-hidden
                />
                {t("photos_layer")}
              </label>
            </div>
            <span className="muted small" style={{ marginTop: "0.5rem" }}>
              {t("gov_layers")}
            </span>
            <div className="gov-layers">
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
            </div>
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
            <button className="btn-ghost" onClick={zoomToData}>
              {t("map_zoom_data")}
            </button>
            <section className="panel-collapsible">
              <button
                className="panel-collapsible-head"
                aria-expanded={basemapOpen}
                onClick={() => setBasemapOpen((v) => !v)}
              >
                {t("section_basemap")}
                <span className="chev" aria-hidden>
                  ▾
                </span>
              </button>
              {basemapOpen && (
                <div className="bm-grid">
                  {(["streets", "imagery"] as const).map((id) => (
                    <button
                      key={id}
                      className={`bm-item${basemap === id ? " bm-active" : ""}`}
                      aria-pressed={basemap === id}
                      onClick={() => setBasemap(id)}
                    >
                      {t(id === "streets" ? "basemap_streets" : "basemap_imagery")}
                    </button>
                  ))}
                </div>
              )}
            </section>
            </div>

            <div role="tabpanel" hidden={tab !== "filters"} className="tabpanel">
            <div className="flt-grid">
              {(
                [
                  ["country", "flt_country", fltOptions("country")],
                  [
                    "province",
                    "flt_province",
                    fltOptions("province", flt.country ? (p) => p.country === flt.country : undefined),
                  ],
                  ["org", "flt_org", fltOptions("org")],
                  ["project", "flt_project", fltOptions("project")],
                  ["activity", "flt_activity", fltOptions("pesActivity")],
                  ["beneficiaryType", "flt_beneficiary", fltOptions("beneficiaryType")],
                  ["gender", "flt_gender", fltOptions("gender")],
                  ["applicationStatus", "flt_status", fltOptions("applicationStatus")],
                ] as const
              ).map(([key, label, options]) => (
                <select
                  key={key}
                  value={flt[key]}
                  aria-label={t(label)}
                  onChange={(e) =>
                    setFlt((f) => ({
                      ...f,
                      [key]: e.target.value,
                      ...(key === "country" ? { province: "" } : null),
                    }))
                  }
                >
                  <option value="">{t(label)}</option>
                  {options.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              ))}
            </div>
            <input
              type="search"
              value={flt.code}
              onChange={(e) => setFlt((f) => ({ ...f, code: e.target.value }))}
              placeholder={t("flt_code_ph")}
              aria-label={t("flt_code_ph")}
            />
            <div className="flt-dates">
              <label className="muted small">
                {t("flt_from")}
                <input
                  type="date"
                  value={flt.from}
                  onChange={(e) => setFlt((f) => ({ ...f, from: e.target.value }))}
                />
              </label>
              <label className="muted small">
                {t("flt_to")}
                <input
                  type="date"
                  value={flt.to}
                  onChange={(e) => setFlt((f) => ({ ...f, to: e.target.value }))}
                />
              </label>
            </div>
            <div className="basemap-row">
              <button className="btn" onClick={() => applyFlt(flt)}>
                {t("flt_apply")}
              </button>
              <button
                className="btn-ghost"
                onClick={() => {
                  setFlt(emptyFlt);
                  applyFlt(emptyFlt);
                }}
              >
                {t("flt_reset")}
              </button>
            </div>
            {fltCount !== null && (
              <span className="flt-matches">{t("flt_match", { n: fltCount })}</span>
            )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
