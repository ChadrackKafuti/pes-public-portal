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
import { fmtNum, useI18n, useT, type Key } from "../i18n";
import { GovInspector } from "./GovInspector";
import { ParcelOverview } from "./ParcelOverview";

/** Congo Basin extent used by portal-v1 (WGS84). */
const CONGO_BASIN: [[number, number], [number, number]] = [
  [5, -14],
  [32, 12],
];

const SRC = "parcels";
const LAYERS = ["parcels-fill", "parcels-line", "parcels-point"] as const;

/** The ArcGIS web map's applications/contracts symbol: transparent fill with
 *  a yellow 2.25px outline (RGB 217,195,30), points in the same yellow. */
export const APP_YELLOW = "#d9c31e";

function addParcelLayers(map: maplibregl.Map, data: FeatureCollection) {
  map.addSource(SRC, { type: "geojson", data });
  map.addLayer({
    id: "parcels-fill",
    type: "fill",
    source: SRC,
    filter: ["==", ["geometry-type"], "Polygon"],
    // near-invisible fill keeps small polygons clickable on imagery
    paint: { "fill-color": APP_YELLOW, "fill-opacity": 0.06 },
  });
  map.addLayer({
    id: "parcels-line",
    type: "line",
    source: SRC,
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: { "line-color": APP_YELLOW, "line-width": 2.25 },
  });
  map.addLayer({
    id: "parcels-point",
    type: "circle",
    source: SRC,
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      "circle-radius": 5.5,
      "circle-color": APP_YELLOW,
      "circle-stroke-width": 1.5,
      "circle-stroke-color": "#ffffff",
    },
  });
}

/** PES contracts (M12): the DataLoad-derived layer (one record per contract
 *  code, latest completed visit, visit shape else application polygon). Drawn
 *  beneath the parcels in the same yellow but dashed, with ring points, so
 *  contracts and applications stay tellable apart where they coincide. */
const CONTRACTS_SRC = "contracts";
const CONTRACT_LAYERS = ["contracts-line", "contracts-point"] as const;

function addContractLayers(map: maplibregl.Map, data: FeatureCollection) {
  if (map.getSource(CONTRACTS_SRC)) return;
  map.addSource(CONTRACTS_SRC, { type: "geojson", data });
  const before = map.getLayer("parcels-fill") ? "parcels-fill" : undefined;
  map.addLayer(
    {
      id: "contracts-line",
      type: "line",
      source: CONTRACTS_SRC,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "line-color": APP_YELLOW,
        "line-width": 2.25,
        "line-dasharray": [2, 1.5],
      },
    },
    before,
  );
  map.addLayer(
    {
      id: "contracts-point",
      type: "circle",
      source: CONTRACTS_SRC,
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": 5,
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-width": 2,
        "circle-stroke-color": APP_YELLOW,
      },
    },
    before,
  );
}

/* Live reference layers from the public UNDP services the v1 web map used
 * (plain HTTP — no ArcGIS SDK). Loaded on demand from the browser. */

const GEOSMART = "https://geosmarthosting.undp.org/arcgis/rest/services";

const ADMIN_LAYERS = {
  admin0: `${GEOSMART}/Hosted/CAFI_admin_0/FeatureServer/0`,
  admin1: `${GEOSMART}/Hosted/CAFI_admin_1/FeatureServer/0`,
} as const;
type AdminKey = keyof typeof ADMIN_LAYERS;

export const SUITABILITY_LAYERS = [
  ["agriculture", `${GEOSMART}/Agriculture_allowed/MapServer`],
  ["conservation", `${GEOSMART}/Conservation_allowed/MapServer`],
  ["agroforestry", `${GEOSMART}/agroforestry_allowed/MapServer`],
  ["forestry", `${GEOSMART}/Forestry_allowed/MapServer`],
  ["reforestation", `${GEOSMART}/Reforestation_allowed1/MapServer`],
  ["regeneration", `${GEOSMART}/Regeneration_allowed/MapServer`],
] as const;
type SuitKey = (typeof SUITABILITY_LAYERS)[number][0];

function addSuitabilityLayer(map: maplibregl.Map, key: SuitKey, base: string) {
  if (map.getSource(`suit-${key}`)) return;
  map.addSource(`suit-${key}`, {
    type: "raster",
    tiles: [
      `${base}/export?dpi=96&transparent=true&format=png32&bbox={bbox-epsg-3857}` +
        `&bboxSR=102100&imageSR=102100&size=256,256&f=image`,
    ],
    tileSize: 256,
  });
  // rasters sit at the very bottom of our overlays
  const before = map
    .getStyle()
    .layers.find((l) => l.id.startsWith("gov-") || l.id.startsWith("parcels-"))?.id;
  map.addLayer(
    { id: `suit-${key}`, type: "raster", source: `suit-${key}`, paint: { "raster-opacity": 0.7 } },
    before,
  );
}

function addAdminLayer(map: maplibregl.Map, key: AdminKey, data: FeatureCollection) {
  if (map.getSource(`admin-${key}`)) return;
  map.addSource(`admin-${key}`, { type: "geojson", data });
  map.addLayer({
    id: `admin-${key}`,
    type: "line",
    source: `admin-${key}`,
    paint:
      key === "admin0"
        ? { "line-color": "#ffffff", "line-width": 1.6 }
        : { "line-color": "#ffffff", "line-width": 0.8, "line-dasharray": [2, 2] },
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

/** Photo markers: the exact picture symbols of the ArcGIS web map
 *  (orange GPS-camera icons), one layer per photo kind. */
const PHOTO_LAYERS = [
  ["photos-app", "application", "photo-app"],
  ["photos-visit", "monitoring_visit", "photo-visit"],
] as const;
const PHOTO_LAYER_IDS = PHOTO_LAYERS.map(([id]) => id);

async function addPhotoLayers(map: maplibregl.Map, data: FeatureCollection) {
  if (map.getSource("photos")) return;
  for (const [, , icon] of PHOTO_LAYERS) {
    if (!map.hasImage(icon)) {
      try {
        const img = await map.loadImage(`markers/${icon}.png`);
        if (!map.hasImage(icon)) map.addImage(icon, img.data);
      } catch {
        /* marker asset missing: fall through, icon layers render nothing */
      }
    }
  }
  if (map.getSource("photos")) return; // a concurrent call won the race
  map.addSource("photos", { type: "geojson", data });
  for (const [id, kind, icon] of PHOTO_LAYERS) {
    map.addLayer({
      id,
      type: "symbol",
      source: "photos",
      filter: ["==", ["get", "kind"], kind],
      layout: {
        "icon-image": icon,
        "icon-size": 19 / 128, // web map draws the 128px picture at ~19px
        "icon-allow-overlap": true,
      },
    });
  }
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
  const [basemap, setBasemap] = useState<BasemapId>("imagery");
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
    setSelected(null);
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

  const fltIdsRef = useRef<Set<string> | null>(null);

  /** Filters apply to every PES layer (v1 §7): photos follow the matched
   *  application ids. */
  const applyPhotoData = () => {
    const map = mapRef.current;
    const base = photosDataRef.current;
    if (!map || !base) return;
    const src = map.getSource("photos") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    const ids = fltIdsRef.current;
    src.setData(
      ids
        ? {
            type: "FeatureCollection",
            features: base.features.filter((f) =>
              ids.has(String((f.properties ?? {}).applicationId ?? "")),
            ),
          }
        : base,
    );
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
    fltIdsRef.current = active
      ? new Set(
          filtered.features.map((ft) =>
            String((ft.properties ?? {}).applicationId ?? ""),
          ),
        )
      : null;
    (map.getSource(SRC) as maplibregl.GeoJSONSource | undefined)?.setData(filtered);
    applyPhotoData();
    applyContractData();
    // the count is applications, not features (each app can be point + polygon)
    setFltCount(active ? (fltIdsRef.current?.size ?? 0) : null);
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

  const [photosOn, setPhotosOn] = useState({ app: false, visit: false });
  const photosDataRef = useRef<FeatureCollection | null>(null);
  const photosOnRef = useRef(photosOn);
  photosOnRef.current = photosOn;

  /* M12 — PES contracts layer (visits-derived, lazy-loaded on first enable). */
  const [contractsOn, setContractsOn] = useState(false);
  const contractsDataRef = useRef<FeatureCollection | null>(null);
  const contractsOnRef = useRef(contractsOn);
  contractsOnRef.current = contractsOn;

  /** Contracts follow the filters through their linked application ids,
   *  exactly like the photo layers. */
  const applyContractData = () => {
    const map = mapRef.current;
    const base = contractsDataRef.current;
    if (!map || !base) return;
    const src = map.getSource(CONTRACTS_SRC) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    const ids = fltIdsRef.current;
    src.setData(
      ids
        ? {
            type: "FeatureCollection",
            features: base.features.filter((f) =>
              ids.has(String((f.properties ?? {}).applicationId ?? "")),
            ),
          }
        : base,
    );
  };

  /* v1 pattern: clicking an application shows its details in the Overview
   * tab, never a separate page. */
  const [selected, setSelected] = useState<{
    id: string;
    seed: Record<string, unknown>;
  } | null>(null);
  const openParcelRef = useRef((id: string, seed: Record<string, unknown>) => {
    setSelected({ id, seed });
    setInspect(null);
    setSideOpen(true);
    setTab("overview");
  });

  /* Reference layers from the UNDP services (admin boundaries, suitability). */
  const [adminOn, setAdminOn] = useState<Record<AdminKey, boolean>>({
    admin0: true, // the web map's country outlines frame the basin by default
    admin1: false,
  });
  const adminDataRef = useRef<Partial<Record<AdminKey, FeatureCollection>>>({});
  const adminOnRef = useRef(adminOn);
  adminOnRef.current = adminOn;
  const [suitOn, setSuitOn] = useState<Record<SuitKey, boolean>>({
    agriculture: false, conservation: false, agroforestry: false,
    forestry: false, reforestation: false, regeneration: false,
  });
  const suitOnRef = useRef(suitOn);
  suitOnRef.current = suitOn;

  /* Application sub-layers (web-map parity: points and polygons separately). */
  const [appLayersOn, setAppLayersOn] = useState({ polygons: true, points: true });
  const appLayersOnRef = useRef(appLayersOn);
  appLayersOnRef.current = appLayersOn;

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
      style: BASEMAPS.imagery,
      bounds: CONGO_BASIN,
      fitBoundsOptions: { padding: 24 },
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    // test hook: lets browser automation address the map deterministically
    (window as unknown as Record<string, unknown>).__cafiMap = map;
    map.on("dragstart", () => (userMovedRef.current = true));
    map.on("wheel", () => (userMovedRef.current = true));
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

    const interactive = [...LAYERS, ...CONTRACT_LAYERS];
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
    // Photo markers win over everything below them.
    for (const id of PHOTO_LAYER_IDS) {
      map.on("click", id, (e) => {
        if (aoiModeRef.current) return;
        const f: MapGeoJSONFeature | undefined = e.features?.[0];
        if (!f) return;
        const el = photoPopupContent(f.properties ?? {}, t("photo_pending"), (appId) => {
          openParcelRef.current(appId, {});
        });
        new maplibregl.Popup({ closeButton: true, maxWidth: "300px" })
          .setLngLat(e.lngLat)
          .setDOMContent(el)
          .addTo(map);
      });
    }
    const photoHit = (e: maplibregl.MapMouseEvent) => {
      const ids = PHOTO_LAYER_IDS.filter((id) => map.getLayer(id));
      return ids.length > 0 && map.queryRenderedFeatures(e.point, { layers: ids }).length > 0;
    };

    map.on("click", (e) => {
      if (aoiModeRef.current || photoHit(e)) return;
      const parcelIds = [...LAYERS, ...CONTRACT_LAYERS].filter((id) => map.getLayer(id));
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
      const p = (f.properties ?? {}) as Record<string, unknown>;
      if (typeof p.applicationId === "string") {
        // v1: the selection's details open in the panel's Overview tab.
        openParcelRef.current(p.applicationId, p);
      }
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
      if (
        photosDataRef.current &&
        (photosOnRef.current.app || photosOnRef.current.visit) &&
        !map.getSource("photos")
      ) {
        void addPhotoLayers(map, photosDataRef.current).then(() => {
          applyPhotoVisRef.current();
          applyPhotoData();
        });
      }
      if (
        contractsDataRef.current &&
        contractsOnRef.current &&
        !map.getSource(CONTRACTS_SRC)
      ) {
        addContractLayers(map, contractsDataRef.current);
        applyContractData();
      }
      for (const key of Object.keys(ADMIN_LAYERS) as AdminKey[]) {
        const data = adminDataRef.current[key];
        if (data && adminOnRef.current[key] && !map.getSource(`admin-${key}`)) {
          addAdminLayer(map, key, data);
        }
      }
      for (const [key, base] of SUITABILITY_LAYERS) {
        if (suitOnRef.current[key] && !map.getSource(`suit-${key}`)) {
          addSuitabilityLayer(map, key, base);
        }
      }
      applyAppVisRef.current();
      if (aoiVertsRef.current.length) {
        setAoiLayers(map, aoiCollection(aoiVertsRef.current, aoiClosedRef.current));
      }
    });
  }, [basemap]);

  // Application sub-layer toggles (points / polygons).
  const applyAppVisRef = useRef(() => {
    const map = mapRef.current;
    if (!map) return;
    const on = appLayersOnRef.current;
    const set = (id: string, vis: boolean) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis ? "visible" : "none");
    };
    set("parcels-fill", on.polygons);
    set("parcels-line", on.polygons);
    set("parcels-point", on.points);
  });
  useEffect(() => {
    applyAppVisRef.current();
  }, [appLayersOn]);

  // Photo layer toggles: lazy-load the data once, then flip per-kind visibility.
  const applyPhotoVisRef = useRef(() => {
    const map = mapRef.current;
    if (!map) return;
    const on = photosOnRef.current;
    for (const [id, kind] of PHOTO_LAYERS) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(
          id,
          "visibility",
          (kind === "application" ? on.app : on.visit) ? "visible" : "none",
        );
      }
    }
  });
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;
    const any = photosOn.app || photosOn.visit;
    if (any && !photosDataRef.current) {
      api
        .photosGeojson()
        .then(async (data) => {
          photosDataRef.current = data as FeatureCollection;
          const m = mapRef.current;
          if (!cancelled && m) {
            await addPhotoLayers(m, data as FeatureCollection);
            applyPhotoVisRef.current();
            applyPhotoData();
          }
        })
        .catch(() => {
          /* photos not synced yet: leave the toggles inert */
        });
    } else if (any && photosDataRef.current && !map.getSource("photos")) {
      void addPhotoLayers(map, photosDataRef.current).then(() => {
        applyPhotoVisRef.current();
        applyPhotoData();
      });
    } else {
      applyPhotoVisRef.current();
    }
    return () => {
      cancelled = true;
    };
  }, [photosOn]);

  // Contracts toggle: lazy-load the derived layer once, then flip visibility.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;
    if (contractsOn && !contractsDataRef.current) {
      api
        .contractsGeojson()
        .then((data) => {
          contractsDataRef.current = data as FeatureCollection;
          const m = mapRef.current;
          if (!cancelled && m && contractsOnRef.current) {
            addContractLayers(m, data as FeatureCollection);
            applyContractData();
          }
        })
        .catch(() => {
          /* visits not synced yet or API down: leave the toggle inert */
        });
    } else if (map.getLayer("contracts-line")) {
      for (const id of CONTRACT_LAYERS) {
        map.setLayoutProperty(id, "visibility", contractsOn ? "visible" : "none");
      }
    } else if (contractsOn && contractsDataRef.current) {
      addContractLayers(map, contractsDataRef.current);
      applyContractData();
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractsOn]);

  // Admin boundary toggles: fetch the public GeoJSON once, then flip visibility.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;
    for (const key of Object.keys(ADMIN_LAYERS) as AdminKey[]) {
      const on = adminOn[key];
      if (on && !adminDataRef.current[key]) {
        fetch(
          `${ADMIN_LAYERS[key]}/query?where=1%3D1&outFields=*&returnGeometry=true` +
            `&geometryPrecision=4&f=geojson`,
        )
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
          .then((data: FeatureCollection) => {
            adminDataRef.current[key] = data;
            const m = mapRef.current;
            if (!cancelled && m && adminOnRef.current[key]) addAdminLayer(m, key, data);
            // Admin 0 defines the home extent: re-fit once it arrives, as
            // long as the map is visible and the user hasn't explored yet.
            if (!cancelled && m && key === "admin0" && everShownRef.current && !userMovedRef.current) {
              const b = dataBounds(data);
              if (b) m.fitBounds(b, { padding: 24 });
            }
          })
          .catch(() => {
            /* UNDP service unreachable: leave the toggle inert */
          });
      } else if (map.getLayer(`admin-${key}`)) {
        map.setLayoutProperty(`admin-${key}`, "visibility", on ? "visible" : "none");
      } else if (on && adminDataRef.current[key]) {
        addAdminLayer(map, key, adminDataRef.current[key]!);
      }
    }
    return () => {
      cancelled = true;
    };
  }, [adminOn]);

  // Suitability raster toggles (live ArcGIS export tiles, no SDK).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const [key, base] of SUITABILITY_LAYERS) {
      const on = suitOn[key];
      if (on && !map.getSource(`suit-${key}`)) {
        addSuitabilityLayer(map, key, base);
      } else if (map.getLayer(`suit-${key}`)) {
        map.setLayoutProperty(`suit-${key}`, "visibility", on ? "visible" : "none");
      }
    }
  }, [suitOn]);

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
  // so the first reveal also re-fits the home extent — the Admin 0 layer's
  // bounds once loaded, the basin constant until then.
  const everShownRef = useRef(false);
  const userMovedRef = useRef(false);
  const homeBounds = () => {
    const a0 = adminDataRef.current.admin0;
    return (a0 && dataBounds(a0)) || new maplibregl.LngLatBounds(CONGO_BASIN);
  };
  useEffect(() => {
    const map = mapRef.current;
    if (!visible || !map) return;
    map.resize();
    if (!everShownRef.current) map.fitBounds(homeBounds(), { padding: 24 });
    everShownRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        userMovedRef.current = true; // an explicit search supersedes the home fit
        map.fitBounds(featureBounds(hit), { padding: 80, maxZoom: 15 });
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  /* M11 — the Overview's default view is a mini dashboard over the applications
   * currently matching the filters (each app can be a point + a polygon:
   * de-duplicate by id). Recomputed per render; fltCount/dataVersion renders
   * keep it in sync with filter applies and the initial load. */
  const ovd = (() => {
    const src = filteredRef.current ?? dataRef.current;
    if (!src) return null;
    const seen = new Map<string, Record<string, unknown>>();
    for (const ft of src.features) {
      const p = (ft.properties ?? {}) as Record<string, unknown>;
      const id = typeof p.applicationId === "string" ? p.applicationId : null;
      if (id && !seen.has(id)) seen.set(id, p);
    }
    let area = 0;
    let tc = 0;
    const byActivity = new Map<string, number>();
    const byCountry = new Map<string, number>();
    for (const p of seen.values()) {
      if (typeof p.areaHa === "number") area += p.areaHa;
      if (typeof p.treeCoverHa === "number") tc += p.treeCoverHa;
      const a = typeof p.pesActivity === "string" ? p.pesActivity : null;
      if (a) byActivity.set(a, (byActivity.get(a) ?? 0) + 1);
      const c = typeof p.country === "string" ? p.country : null;
      if (c) byCountry.set(c, (byCountry.get(c) ?? 0) + 1);
    }
    const top = (m: Map<string, number>) =>
      [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5);
    return {
      n: seen.size,
      area,
      tc,
      countries: byCountry.size,
      byActivity: top(byActivity),
      byCountry: top(byCountry),
    };
  })();

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
              {selected ? (
                <ParcelOverview
                  id={selected.id}
                  seed={selected.seed}
                  onClose={() => setSelected(null)}
                />
              ) : inspect ? (
                <GovInspector
                  srcUid={inspect.srcUid}
                  layer={inspect.layer}
                  seed={inspect.seed}
                  onClose={() => setInspect(null)}
                />
              ) : (
                <>
                  {ovd && ovd.n > 0 && (
                    <>
                      <div className="ovd-tiles">
                        <div className="ovd-tile">
                          <strong>{fmtNum(ovd.n, locale, 0)}</strong>
                          <span>{t("dash_applications")}</span>
                        </div>
                        <div className="ovd-tile">
                          <strong>{fmtNum(ovd.area, locale, 0)} ha</strong>
                          <span>{t("dash_total_area")}</span>
                        </div>
                        <div className="ovd-tile">
                          <strong>{fmtNum(ovd.tc, locale, 0)} ha</strong>
                          <span>{t("dash_tc")}</span>
                        </div>
                        <div className="ovd-tile">
                          <strong>{fmtNum(ovd.countries, locale, 0)}</strong>
                          <span>{t("dash_countries")}</span>
                        </div>
                      </div>
                      {ovd.byActivity.length > 0 && (
                        <div className="ovd-bars">
                          {(() => {
                            const max = ovd.byActivity[0][1] || 1;
                            return ovd.byActivity.map(([label, n]) => (
                              <div className="barlist-row" key={label}>
                                <span className="barlist-label" title={label}>{label}</span>
                                <span className="barlist-track">
                                  <span className="barlist-bar" style={{ width: `${(n / max) * 100}%` }} />
                                </span>
                                <span className="barlist-value">{fmtNum(n, locale, 0)}</span>
                              </div>
                            ));
                          })()}
                        </div>
                      )}
                      <p className="ovd-hint">{t("dash_filtered_hint")}</p>
                    </>
                  )}
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
            <div className="gov-layers">
              <label>
                <input
                  type="checkbox"
                  checked={appLayersOn.polygons}
                  onChange={(e) => setAppLayersOn({ ...appLayersOn, polygons: e.target.checked })}
                />
                <i className="legend-line" style={{ borderColor: APP_YELLOW }} aria-hidden />
                {t("lyr_app_polys")}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={appLayersOn.points}
                  onChange={(e) => setAppLayersOn({ ...appLayersOn, points: e.target.checked })}
                />
                <i className="legend-dot" style={{ background: APP_YELLOW }} aria-hidden />
                {t("lyr_app_points")}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={contractsOn}
                  onChange={(e) => setContractsOn(e.target.checked)}
                />
                <i
                  className="legend-line"
                  style={{ borderColor: APP_YELLOW, borderStyle: "dashed" }}
                  aria-hidden
                />
                {t("lyr_contracts")}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={photosOn.app}
                  onChange={(e) => setPhotosOn({ ...photosOn, app: e.target.checked })}
                />
                <img className="legend-icon" src="markers/photo-app.png" alt="" aria-hidden />
                {t("photos_app_layer")}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={photosOn.visit}
                  onChange={(e) => setPhotosOn({ ...photosOn, visit: e.target.checked })}
                />
                <img className="legend-icon" src="markers/photo-visit.png" alt="" aria-hidden />
                {t("photos_visit_layer")}
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
            <span className="muted small" style={{ marginTop: "0.5rem" }}>
              {t("admin_title")}
            </span>
            <div className="gov-layers">
              {(Object.keys(ADMIN_LAYERS) as AdminKey[]).map((key) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={adminOn[key]}
                    onChange={(e) => setAdminOn({ ...adminOn, [key]: e.target.checked })}
                  />
                  {t(key === "admin0" ? "admin0_layer" : "admin1_layer")}
                </label>
              ))}
            </div>
            <span className="muted small" style={{ marginTop: "0.5rem" }}>
              {t("suit_title")}
            </span>
            <div className="gov-layers">
              {SUITABILITY_LAYERS.map(([key]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={suitOn[key]}
                    onChange={(e) => setSuitOn({ ...suitOn, [key]: e.target.checked })}
                  />
                  {t(`suit_${key}` as Key)}
                </label>
              ))}
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
