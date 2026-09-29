/** PES layer discovery, popup repair, full-feature fetch, filter application, code search, visibility presets. */
import type Map from "@arcgis/core/Map";
import type MapView from "@arcgis/core/views/MapView";
import type Graphic from "@arcgis/core/Graphic";
import type Layer from "@arcgis/core/layers/Layer";
import type FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import { CONFIG } from "@/config";
import { buildWhere, findField, type FilterState } from "@/filters";
import { sql } from "./query";

export interface PesLayers {
  all: FeatureLayer[];
  applications: FeatureLayer | null;
  polygons: FeatureLayer | null;
  contracts: FeatureLayer | null;
  visits: FeatureLayer | null;
  photos: FeatureLayer[];
}

export const isPesLayer = (layer: unknown): layer is FeatureLayer => {
  const l = layer as { type?: string; url?: string } | null | undefined;
  return !!l && l.type === "feature" && CONFIG.filterableLayerPattern.test(l.url ?? "");
};

const isDataField = (name: string) => !/^(shape__|shape_|objectid$|globalid$)/i.test(name);

/** Layers without a web-map popup borrow the popup of a layer with the same data fields, else the default one. */
export function ensurePopups(layers: FeatureLayer[]): void {
  const donors = layers.filter((l) => l.popupTemplate);
  for (const layer of layers) {
    if (layer.popupTemplate) continue;
    const fields = new Set((layer.fields ?? []).map((f) => f.name.toLowerCase()));
    const donor = donors.find((d) => (d.fields ?? []).filter((f) => isDataField(f.name)).every((f) => fields.has(f.name.toLowerCase())));
    const template = donor?.popupTemplate;
    layer.popupTemplate = template ? template.clone() : layer.createPopupTemplate();
  }
}

export async function collectPesLayers(map: Map): Promise<PesLayers> {
  const candidates = map.allLayers.filter(isPesLayer).toArray() as FeatureLayer[];
  await Promise.allSettled(candidates.map((l) => l.load()));
  const all = candidates.filter((l) => l.loaded);
  ensurePopups(all);
  const byUrl = (re: RegExp) => all.find((l) => re.test(l.url ?? "")) ?? null;
  return {
    all,
    applications: byUrl(CONFIG.applicationsLayerPattern) ?? all.find((l) => findField(l, ["applicationcode"])) ?? null,
    polygons: byUrl(/Applications_Polygons/i),
    contracts: byUrl(/Data_Contracts/i),
    visits: byUrl(/MonitoringVisits/i),
    photos: all.filter((l) => /GeoTagged/i.test(l.url ?? "")),
  };
}

/** Hit-test graphics carry few attributes: fetch the complete feature (the Arcade popups need every field). */
export async function fullFeature(view: MapView, graphic: Graphic): Promise<Graphic | null> {
  const layer = graphic.layer as FeatureLayer | null;
  if (!layer || layer.type !== "feature") return null;
  const oid = graphic.attributes?.[layer.objectIdField];
  if (oid === undefined || oid === null) return null;
  try {
    const result = await layer.queryFeatures({
      objectIds: [oid],
      outFields: ["*"],
      returnGeometry: true,
      outSpatialReference: view.spatialReference,
    });
    const full = result.features[0] ?? null;
    if (full) full.layer = layer;
    return full;
  } catch {
    return null;
  }
}

export function applyFilterState(layers: FeatureLayer[], state: FilterState): void {
  for (const layer of layers) layer.definitionExpression = buildWhere(layer, state);
}

/** Find an application (points, then polygons) or a contract by code; returns the full graphic. */
export async function searchByCode(pes: PesLayers, code: string, view: MapView): Promise<Graphic | null> {
  const escaped = sql(code.toUpperCase());
  const ordered = [pes.applications, pes.polygons, pes.contracts, ...pes.all].filter((l, i, a): l is FeatureLayer => !!l && a.indexOf(l) === i);
  for (const layer of ordered) {
    const field = findField(layer, [CONFIG.searchField, "contractcode"]);
    if (!field) continue;
    try {
      const result = await layer.queryFeatures({
        where: `UPPER(${field}) = ${escaped}`,
        outFields: ["*"],
        returnGeometry: true,
        num: 1,
        outSpatialReference: view.spatialReference,
      });
      const g = result.features[0];
      if (g?.geometry) {
        g.layer = layer;
        return g;
      }
    } catch {
      /* try the next layer */
    }
  }
  return null;
}

/** Visibility presets on the shared view (Analyses shows contracts only), restorable. */
export type VisibilitySnapshot = Array<[Layer, boolean]>;

export function applyAnalysisPreset(map: Map, pes: PesLayers): VisibilitySnapshot {
  const snapshot: VisibilitySnapshot = map.allLayers.map((l) => [l, l.visible] as [Layer, boolean]).toArray();
  for (const layer of pes.all) layer.visible = layer === pes.contracts;
  const forest = map.findLayerById("forest-governance");
  if (forest) forest.visible = false;
  return snapshot;
}

export function restoreVisibility(snapshot: VisibilitySnapshot): void {
  for (const [layer, visible] of snapshot) layer.visible = visible;
}
