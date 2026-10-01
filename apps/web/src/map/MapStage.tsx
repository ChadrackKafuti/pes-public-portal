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
  basemap: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c3 3.5 3 14 0 18-3-4-3-14.5 0-18Z" />
    </svg>
  ),
};

/** One collapsible sidebar section (hand-rolled accordion). */
function MsSection({
  title,
  icon,
  open,
  onToggle,
  children,
}: {
  title: string;
  icon: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="ms-section">
      <button className="ms-head" aria-expanded={open} onClick={onToggle}>
        {icon}
        {title}
        <span className="ms-chevron">▶</span>
      </button>
      {open && <div className="ms-body">{children}</div>}
    </section>
  );
}

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
  const [sideOpen, setSideOpen] = useState(true);
  const [sections, setSections] = useState({
    analysis: true,
    layers: true,
    find: false,
    basemap: false,
  });
  const toggleSection = (k: keyof typeof sections) =>
    setSections((s) => ({ ...s, [k]: !s[k] }));
  const [govInfo, setGovInfo] = useState<GovLayerInfo[] | null>(null);
  const [govVisible, setGovVisible] = useState<Partial<Record<GovLayerKey, boolean>>>({});
  const [govOpacity, setGovOpacity] = useState(1);
  const govDataRef = useRef<Partial<Record<GovLayerKey, FeatureCollection>>>({});
  const govVisibleRef = useRef(govVisible);
  govVisibleRef.current = govVisible;

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
      const el = govPopupContent(key, hit.properties ?? {}, localeRef.current, t("gov_documents"));
      new maplibregl.Popup({ closeButton: true, maxWidth: "300px" })
        .setLngLat(e.lngLat)
        .setDOMContent(el)
        .addTo(map);
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
        addParcelLayers(map, dataRef.current);
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

  // Layer inventory, fetched the first time the layers section shows.
  useEffect(() => {
    if (sideOpen && sections.layers && govInfo === null) {
      api.governanceLayers().then(setGovInfo).catch(() => setGovInfo([]));
    }
  }, [sideOpen, sections.layers, govInfo]);

  // The map shares the row with the sidebar: re-measure on toggle.
  useEffect(() => {
    mapRef.current?.resize();
  }, [sideOpen]);

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
      {sideOpen ? (
        <aside className="map-sidebar">
          <MsSection
            title={t("section_analysis")}
            icon={MS_ICONS.analysis}
            open={sections.analysis}
            onToggle={() => toggleSection("analysis")}
          >
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
          </MsSection>

          <MsSection
            title={t("section_layers")}
            icon={MS_ICONS.layers}
            open={sections.layers}
            onToggle={() => toggleSection("layers")}
          >
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
          </MsSection>

          <MsSection
            title={t("section_find")}
            icon={MS_ICONS.find}
            open={sections.find}
            onToggle={() => toggleSection("find")}
          >
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("map_find_placeholder")}
              aria-label={t("map_find_placeholder")}
            />
            {miss && <span className="map-miss">{t("map_no_match")}</span>}
          </MsSection>

          <MsSection
            title={t("section_basemap")}
            icon={MS_ICONS.basemap}
            open={sections.basemap}
            onToggle={() => toggleSection("basemap")}
          >
            <div className="basemap-row">
              <button
                className={`btn-ghost${basemap === "streets" ? " active" : ""}`}
                onClick={() => setBasemap("streets")}
              >
                {t("basemap_streets")}
              </button>
              <button
                className={`btn-ghost${basemap === "imagery" ? " active" : ""}`}
                onClick={() => setBasemap("imagery")}
              >
                {t("basemap_imagery")}
              </button>
            </div>
          </MsSection>

          <div className="ms-foot">
            <button className="ms-collapse" onClick={() => setSideOpen(false)}>
              « {t("sidebar_collapse")}
            </button>
          </div>
        </aside>
      ) : (
        <button className="ms-toggle" onClick={() => setSideOpen(true)} title={t("sidebar_expand")}>
          ☰
        </button>
      )}
      <div ref={container} className="map-stage" />
      {!sideOpen && (
      <div className="map-legend legend-flush">
        <span className="gov-legend-row">
          <i style={{ background: PARCEL_DEFAULT_COLOR }} /> {t("legend_not_processed")}
        </span>
        {Object.entries(PARCEL_STATUS_COLORS).map(([k, c]) => (
          <span key={k} className="gov-legend-row">
            <i style={{ background: c }} /> {k}
          </span>
        ))}
      </div>
      )}
    </div>
  );
}
