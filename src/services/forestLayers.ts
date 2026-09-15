/**
 * "Other areas of interest": the Congo Basin forest-governance layers published by cb_forest_ingest.py into the
 * public service Hosted/Protected_areas. The web map may already reference these sublayers (after
 * repoint_webmaps.py) or the three legacy layers; both are replaced by this configured group so that the
 * Arcade popups (src/arcade), the zoning symbology and the production filter are always applied.
 *
 * Layer titles are load-bearing: the popups look up related layers with FeatureSetByName($map, title).
 * Display names live in i18n/forestLabels.ts.
 */
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import GroupLayer from "@arcgis/core/layers/GroupLayer";
import type Map from "@arcgis/core/Map";
import type Layer from "@arcgis/core/layers/Layer";
import PopupTemplate from "@arcgis/core/PopupTemplate";
import ExpressionContent from "@arcgis/core/popup/content/ExpressionContent";
import SimpleRenderer from "@arcgis/core/renderers/SimpleRenderer";
import UniqueValueRenderer from "@arcgis/core/renderers/UniqueValueRenderer";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import { CONFIG } from "@/config";
import type { Lang } from "@/i18n";
import { ZONE_CLASS_LABELS, ZONE_LEGEND_TITLE, forestLayerLabel } from "@/i18n/forestLabels";

import popupConcessions from "@/arcade/popup_concessions.arcade?raw";
import popupCommunityForests from "@/arcade/popup_community_forests.arcade?raw";
import popupZoning from "@/arcade/popup_zoning.arcade?raw";
import popupLocalTerritories from "@/arcade/popup_local_territories.arcade?raw";
import popupProtectedAreas from "@/arcade/popup_protected_areas.arcade?raw";
import symbologyZoneType from "@/arcade/symbology_zone_type.arcade?raw";

/** Production filter recommended by the ingest script. */
export const FOREST_FILTER = "retired = 0 AND situation IN ('complete','part_complete')";
export const FOREST_GROUP_ID = "forest-governance";
export const DOCS_TABLE_TITLE = "CB_Documents";

const OUTLINE = { color: [75, 75, 75, 1], width: 0.4 };
const LIMIT_COLORS: Record<string, number[]> = {
  concessions: [204, 120, 60, 0.45],
  community_forests: [60, 150, 90, 0.45],
  local_territories: [80, 120, 200, 0.45],
  protected_areas: [46, 125, 50, 0.4],
};

/** Popup title expressions (dictionary named LBL: Arcade identifiers are case-insensitive). */
const TITLES: Record<string, string> = {
  concessions: `var LBL = {'ufa':'UFA','communal_forest':'Forêt communale','timber_sale':'Vente de coupe','pea':'PEA','ccf_exploitation':'CCF','ccf_conservation':'Concession de conservation','concession':'Concession','parcel':'Parcela','permit':'Permis','ufa_cfad':'UFA/CFAD'};
var s = $feature.sub_type_std; var t = 'Titre'; if (!IsEmpty(s)) { if (HasKey(LBL, s)) { t = LBL[s]; } }
var n = $feature.name; if (IsEmpty(n)) { n = $feature.reference; } if (IsEmpty(n)) { n = 'sans nom'; }
var c = $feature.iso3; if (IsEmpty(c)) { c = ''; }
return t + ' · ' + n + ' (' + c + ')';`,
  community_forests: `var LBL = {'community_forest':'Forêt communautaire','cfcl':'CFCL','cfcl_application':'Demande CFCL','communal_forest':'Forêt communale','bosque_comunal':'Bosque comunal'};
var s = $feature.sub_type_std; var t = 'Forêt communautaire'; if (!IsEmpty(s)) { if (HasKey(LBL, s)) { t = LBL[s]; } }
var n = $feature.name; if (IsEmpty(n)) { n = $feature.community; } if (IsEmpty(n)) { n = 'sans nom'; }
var c = $feature.iso3; if (IsEmpty(c)) { c = ''; }
return t + ' · ' + n + ' (' + c + ')';`,
  zoning: `var LBL = {'production':'Production','conservation':'Conservation','protection':'Protection','community_development':'Développement rural','agriculture':'Agriculture','habitat':'Habitat','savanna_protection':'Mise en défens','concession':'Zone concédée','community_forest':'Forêt communautaire','conflict':'Zone conflictuelle','research':'Recherche','unclassified':'Non classée','other':'Autre'};
var k = $feature.zone_type_std; var z = 'Zone'; if (!IsEmpty(k)) { if (HasKey(LBL, k)) { z = LBL[k]; } }
var p = $feature.parent_name; if (IsEmpty(p)) { return z; }
return z + ' · ' + p;`,
  local_territories: `var n = $feature.name; if (IsEmpty(n)) { n = 'sans nom'; }
var a = $feature.admin2; if (IsEmpty(a)) { return 'Terroir ' + n; }
return 'Terroir ' + n + ' · ' + a;`,
  protected_areas: `var LBL = {'national_park':'Parc national','world_heritage':'Patrimoine mondial','biosphere_reserve':'Réserve de biosphère','ramsar':'Site Ramsar','sanctuary':'Sanctuaire','wildlife_reserve':'Réserve de faune','nature_reserve':'Réserve naturelle','strict_reserve':'Réserve intégrale','forest_reserve':'Réserve forestière','community_reserve':'Réserve communautaire','hunting_zone':'ZIC','botanical_garden':'Jardin','natural_monument':'Monument naturel','marine_protected_area':'AMP'};
var s = $feature.sub_type_std; var t = 'Aire protégée'; if (!IsEmpty(s)) { if (HasKey(LBL, s)) { t = LBL[s]; } }
var n = $feature.name; if (IsEmpty(n)) { n = 'sans nom'; }
var c = $feature.iso3; if (IsEmpty(c)) { c = ''; }
return t + ' · ' + n + ' (' + c + ')';`,
};

export interface ForestLayerDef {
  key: string;
  id: number;
  /** load-bearing title (FeatureSetByName in the popups) */
  title: string;
  kind: "limits" | "zoning";
  popup: string;
  titleKey: string;
}

export const FOREST_LAYERS: ForestLayerDef[] = [
  { key: "concession_zoning", id: 2, title: "Logging concessions - Zoning", kind: "zoning", popup: popupZoning, titleKey: "zoning" },
  { key: "concessions", id: 1, title: "Logging concessions - Limits", kind: "limits", popup: popupConcessions, titleKey: "concessions" },
  { key: "local_territory_zoning", id: 6, title: "Local territories - Zoning", kind: "zoning", popup: popupZoning, titleKey: "zoning" },
  { key: "local_territories", id: 5, title: "Local territories - Limits", kind: "limits", popup: popupLocalTerritories, titleKey: "local_territories" },
  { key: "protected_areas", id: 0, title: "CB Protected Areas", kind: "limits", popup: popupProtectedAreas, titleKey: "protected_areas" },
  { key: "community_forest_zoning", id: 4, title: "Community forest - Zoning", kind: "zoning", popup: popupZoning, titleKey: "zoning" },
  { key: "community_forests", id: 3, title: "Community forests - Limits", kind: "limits", popup: popupCommunityForests, titleKey: "community_forests" },
];
const titleOf = (key: string) => FOREST_LAYERS.find((d) => d.key === key)!.title;
export const forestKeyOfTitle = (title: string) => FOREST_LAYERS.find((d) => d.title === title)?.key ?? null;

/** Point the popups' layer-name constants at our titles and disable the portal fallback (blocked by CORS). */
function adaptPopup(source: string, key: string): string {
  const names: Record<string, string> = {
    NAME_ZONING:
      key === "concessions" ? titleOf("concession_zoning")
      : key === "community_forests" ? titleOf("community_forest_zoning")
      : titleOf("local_territory_zoning"),
    NAME_DOCS: DOCS_TABLE_TITLE,
    NAME_CONC: titleOf("concessions"),
    NAME_CF: titleOf("community_forests"),
  };
  let text = source.replace(/^var ITEM_ID\s*=\s*"[^"]*"/m, 'var ITEM_ID = "PASTE_ITEM_ID_HERE"');
  for (const [constant, value] of Object.entries(names)) {
    text = text.replace(new RegExp(`^var ${constant}\\s*=\\s*"[^"]*"`, "m"), `var ${constant} = "${value}"`);
  }
  return text
    .replaceAll('"CB_Logging_Concessions"', `"${titleOf("concessions")}"`)
    .replaceAll('"CB_Community_Forests"', `"${titleOf("community_forests")}"`)
    .replaceAll('"CB_Local_Territories"', `"${titleOf("local_territories")}"`)
    .replaceAll('"CB_Concession_Zoning"', `"${titleOf("concession_zoning")}"`)
    .replaceAll('"CB_Community_Forest_Zoning"', `"${titleOf("community_forest_zoning")}"`)
    .replaceAll('"CB_Local_Territory_Zoning"', `"${titleOf("local_territory_zoning")}"`);
}

function hexToRgba(hex: string, alpha: number): number[] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}

/** Renderer with legend labels in the given language (values are the Arcade expression's French labels). */
export function forestRenderer(def: ForestLayerDef, lang: Lang) {
  if (def.kind === "zoning") {
    return new UniqueValueRenderer({
      valueExpression: symbologyZoneType,
      valueExpressionTitle: ZONE_LEGEND_TITLE[lang],
      defaultSymbol: new SimpleFillSymbol({ color: [189, 189, 189, 0.5], outline: OUTLINE }),
      defaultLabel: ZONE_CLASS_LABELS.find((z) => z.value === "Non classée")!.label[lang],
      uniqueValueInfos: ZONE_CLASS_LABELS.map((z) => ({
        value: z.value,
        label: z.label[lang],
        symbol: new SimpleFillSymbol({ color: hexToRgba(z.color, def.key === "concession_zoning" ? 0.6 : 0.8), outline: OUTLINE }),
      })),
    });
  }
  return new SimpleRenderer({
    symbol: new SimpleFillSymbol({ color: LIMIT_COLORS[def.key] ?? [120, 120, 120, 0.4], outline: { color: [60, 60, 60, 1], width: 0.8 } }),
  });
}

export function buildForestGroup(lang: Lang): GroupLayer {
  const layers = FOREST_LAYERS.map(
    (def) =>
      new FeatureLayer({
        id: `forest-${def.key}`,
        url: `${CONFIG.forestServiceUrl}/${def.id}`,
        title: def.title,
        visible: false,
        outFields: ["*"],
        definitionExpression: FOREST_FILTER,
        renderer: forestRenderer(def, lang),
        popupTemplate: new PopupTemplate({
          title: "{expression/title}",
          expressionInfos: [{ name: "title", expression: TITLES[def.titleKey] }],
          content: [new ExpressionContent({ expressionInfo: { expression: adaptPopup(def.popup, def.key), title: def.title } })],
        }),
      }),
  );
  return new GroupLayer({ id: FOREST_GROUP_ID, title: CONFIG.forestGroupTitle, visible: true, visibilityMode: "independent", layers });
}

export function buildDocumentsTable(): FeatureLayer {
  return new FeatureLayer({ id: "forest-documents", url: `${CONFIG.forestServiceUrl}/7`, title: DOCS_TABLE_TITLE, outFields: ["*"] });
}

function isForestServiceLayer(layer: Layer): boolean {
  const url = (layer as { url?: string }).url ?? "";
  return url.startsWith(CONFIG.forestServiceUrl) || CONFIG.replacedLayerTitles.includes(layer.title ?? "");
}

/** Replace the web map's forest/legacy layers by the configured group at the same position (map must be loaded). */
export function installForestLayers(map: Map, lang: Lang): GroupLayer {
  const group = buildForestGroup(lang);
  let index = -1;
  for (const layer of map.allLayers.filter(isForestServiceLayer).toArray()) {
    const parent = (layer as unknown as { parent?: Map | GroupLayer }).parent;
    const collection = parent && "layers" in parent ? parent.layers : map.layers;
    const i = collection.indexOf(layer);
    if (index < 0 && collection === map.layers) index = i;
    collection.remove(layer);
  }
  map.layers.add(group, index >= 0 ? Math.min(index, map.layers.length) : undefined);
  if (!map.tables.some((t) => t.title === DOCS_TABLE_TITLE)) map.tables.add(buildDocumentsTable());
  return group;
}

/** Re-label the group's renderers for a new language (legend follows). */
export function relabelForestGroup(group: GroupLayer, lang: Lang): void {
  for (const layer of group.layers.toArray() as FeatureLayer[]) {
    const def = FOREST_LAYERS.find((d) => d.title === layer.title);
    if (def && def.kind === "zoning") layer.renderer = forestRenderer(def, lang);
  }
}

export function forestDisplayName(layer: Layer, lang: Lang): string | null {
  const key = forestKeyOfTitle(layer.title ?? "");
  return key ? forestLayerLabel(key, lang) : null;
}
