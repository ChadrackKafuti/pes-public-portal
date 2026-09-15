/**
 * "Other areas of interest": the Congo Basin forest-governance layers published by cb_forest_ingest.py into the
 * public service Hosted/Protected_areas (item "Other areas of interest"). They replace the three legacy layers of the
 * web map and reuse the Arcade popups written for those layers (src/arcade, copied from CAFI Spatial Reporting/arcade).
 */
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import GroupLayer from "@arcgis/core/layers/GroupLayer";
import type Map from "@arcgis/core/Map";
import PopupTemplate from "@arcgis/core/PopupTemplate";
import ExpressionContent from "@arcgis/core/popup/content/ExpressionContent";
import SimpleRenderer from "@arcgis/core/renderers/SimpleRenderer";
import UniqueValueRenderer from "@arcgis/core/renderers/UniqueValueRenderer";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import { CONFIG } from "./config";

import popupConcessions from "./arcade/popup_concessions.arcade?raw";
import popupCommunityForests from "./arcade/popup_community_forests.arcade?raw";
import popupZoning from "./arcade/popup_zoning.arcade?raw";
import popupLocalTerritories from "./arcade/popup_local_territories.arcade?raw";
import popupProtectedAreas from "./arcade/popup_protected_areas.arcade?raw";
import symbologyZoneType from "./arcade/symbology_zone_type.arcade?raw";

/** Production filter recommended by the ingest script. */
export const FOREST_FILTER = "retired = 0 AND situation IN ('complete','part_complete')";

const OUTLINE = { color: [75, 75, 75, 1], width: 0.4 };

/** Fill colours of the limits layers (from cb_forest_ingest.py LAYER_COLORS) and of the zoning classes (README_arcade). */
const LIMIT_COLORS: Record<string, number[]> = {
  concessions: [204, 120, 60, 0.45],
  community_forests: [60, 150, 90, 0.45],
  local_territories: [80, 120, 200, 0.45],
  protected_areas: [46, 125, 50, 0.4],
};
const ZONE_COLORS: Array<[string, string]> = [
  ["Production (exploitation ligneuse)", "#c98a2b"],
  ["Conservation", "#2e7d32"],
  ["Protection", "#00695c"],
  ["Développement rural / communautaire", "#a0522d"],
  ["Agriculture et agroforesterie", "#d4b106"],
  ["Habitat", "#8d6e63"],
  ["Mise en défens / reboisement", "#7cb342"],
  ["Zone concédée (titres tiers)", "#5d4037"],
  ["Forêt communautaire", "#43a047"],
  ["Zone conflictuelle", "#d32f2f"],
  ["Recherche", "#7e57c2"],
  ["Non classée", "#bdbdbd"],
  ["Autre", "#607d8b"],
];

/** Popup title expressions (from titles.arcade). */
const TITLES: Record<string, string> = {
  concessions: `var T = {'ufa':'UFA','communal_forest':'Forêt communale','timber_sale':'Vente de coupe','pea':'PEA','ccf_exploitation':'CCF','ccf_conservation':'Concession de conservation','concession':'Concession','parcel':'Parcela','permit':'Permis','ufa_cfad':'UFA/CFAD'};
var s = $feature.sub_type_std; var t = 'Titre'; if (!IsEmpty(s)) { if (HasKey(T, s)) { t = T[s]; } }
var n = $feature.name; if (IsEmpty(n)) { n = $feature.reference; } if (IsEmpty(n)) { n = 'sans nom'; }
var c = $feature.iso3; if (IsEmpty(c)) { c = ''; }
return t + ' · ' + n + ' (' + c + ')';`,
  community_forests: `var T = {'community_forest':'Forêt communautaire','cfcl':'CFCL','cfcl_application':'Demande CFCL','communal_forest':'Forêt communale','bosque_comunal':'Bosque comunal'};
var s = $feature.sub_type_std; var t = 'Forêt communautaire'; if (!IsEmpty(s)) { if (HasKey(T, s)) { t = T[s]; } }
var n = $feature.name; if (IsEmpty(n)) { n = $feature.community; } if (IsEmpty(n)) { n = 'sans nom'; }
var c = $feature.iso3; if (IsEmpty(c)) { c = ''; }
return t + ' · ' + n + ' (' + c + ')';`,
  zoning: `var Z = {'production':'Production','conservation':'Conservation','protection':'Protection','community_development':'Développement rural','agriculture':'Agriculture','habitat':'Habitat','savanna_protection':'Mise en défens','concession':'Zone concédée','community_forest':'Forêt communautaire','conflict':'Zone conflictuelle','research':'Recherche','unclassified':'Non classée','other':'Autre'};
var k = $feature.zone_type_std; var z = 'Zone'; if (!IsEmpty(k)) { if (HasKey(Z, k)) { z = Z[k]; } }
var p = $feature.parent_name; if (IsEmpty(p)) { return z; }
return z + ' · ' + p;`,
  local_territories: `var n = $feature.name; if (IsEmpty(n)) { n = 'sans nom'; }
var a = $feature.admin2; if (IsEmpty(a)) { return 'Terroir ' + n; }
return 'Terroir ' + n + ' · ' + a;`,
  protected_areas: `var P = {'national_park':'Parc national','world_heritage':'Patrimoine mondial','biosphere_reserve':'Réserve de biosphère','ramsar':'Site Ramsar','sanctuary':'Sanctuaire','wildlife_reserve':'Réserve de faune','nature_reserve':'Réserve naturelle','strict_reserve':'Réserve intégrale','forest_reserve':'Réserve forestière','community_reserve':'Réserve communautaire','hunting_zone':'ZIC','botanical_garden':'Jardin','natural_monument':'Monument naturel','marine_protected_area':'AMP'};
var s = $feature.sub_type_std; var t = 'Aire protégée'; if (!IsEmpty(s)) { if (HasKey(P, s)) { t = P[s]; } }
var n = $feature.name; if (IsEmpty(n)) { n = 'sans nom'; }
var c = $feature.iso3; if (IsEmpty(c)) { c = ''; }
return t + ' · ' + n + ' (' + c + ')';`,
};

interface ForestLayerDef {
  key: string;
  id: number;
  title: string;
  kind: "limits" | "zoning";
  popup: string;
  titleKey: string;
}

/** Layer titles are constant (they are also the names the Arcade popups use to find related layers with FeatureSetByName). */
export const FOREST_LAYERS: ForestLayerDef[] = [
  { key: "concession_zoning", id: 2, title: "Logging concessions - Zoning", kind: "zoning", popup: popupZoning, titleKey: "zoning" },
  { key: "concessions", id: 1, title: "Logging concessions - Limits", kind: "limits", popup: popupConcessions, titleKey: "concessions" },
  { key: "local_territory_zoning", id: 6, title: "Local territories - Zoning", kind: "zoning", popup: popupZoning, titleKey: "zoning" },
  { key: "local_territories", id: 5, title: "Local territories - Limits", kind: "limits", popup: popupLocalTerritories, titleKey: "local_territories" },
  { key: "protected_areas", id: 0, title: "CB Protected Areas", kind: "limits", popup: popupProtectedAreas, titleKey: "protected_areas" },
  { key: "community_forest_zoning", id: 4, title: "Community forest - Zoning", kind: "zoning", popup: popupZoning, titleKey: "zoning" },
  { key: "community_forests", id: 3, title: "Community forests - Limits", kind: "limits", popup: popupCommunityForests, titleKey: "community_forests" },
];
const DOCS_TABLE_TITLE = "CB_Documents";
const titleOf = (key: string) => FOREST_LAYERS.find((d) => d.key === key)!.title;

/**
 * The popup files look up related layers by name (FeatureSetByName) and fall back to FeatureSetByPortalItem, which
 * cannot work here (the portal blocks cross-origin requests): point the name constants at our layer titles and
 * disable the portal fallback.
 */
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
  // the zoning popup maps each layer to its parent by name: rewrite the CB_ names to our titles
  text = text
    .replaceAll('"CB_Logging_Concessions"', `"${titleOf("concessions")}"`)
    .replaceAll('"CB_Community_Forests"', `"${titleOf("community_forests")}"`)
    .replaceAll('"CB_Local_Territories"', `"${titleOf("local_territories")}"`)
    .replaceAll('"CB_Concession_Zoning"', `"${titleOf("concession_zoning")}"`)
    .replaceAll('"CB_Community_Forest_Zoning"', `"${titleOf("community_forest_zoning")}"`)
    .replaceAll('"CB_Local_Territory_Zoning"', `"${titleOf("local_territory_zoning")}"`);
  return text;
}

function renderer(def: ForestLayerDef) {
  if (def.kind === "zoning") {
    return new UniqueValueRenderer({
      valueExpression: symbologyZoneType,
      valueExpressionTitle: "Affectation",
      defaultSymbol: new SimpleFillSymbol({ color: [189, 189, 189, 0.5], outline: OUTLINE }),
      defaultLabel: "Non classée",
      uniqueValueInfos: ZONE_COLORS.map(([label, color]) => ({
        value: label,
        label,
        symbol: new SimpleFillSymbol({ color: hexToRgba(color, def.key === "concession_zoning" ? 0.6 : 0.8), outline: OUTLINE }),
      })),
    });
  }
  return new SimpleRenderer({
    symbol: new SimpleFillSymbol({ color: LIMIT_COLORS[def.key] ?? [120, 120, 120, 0.4], outline: { color: [60, 60, 60, 1], width: 0.8 } }),
  });
}

function hexToRgba(hex: string, alpha: number): number[] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}

export function buildForestGroup(): GroupLayer {
  const layers = FOREST_LAYERS.map(
    (def) =>
      new FeatureLayer({
        url: `${CONFIG.forestServiceUrl}/${def.id}`,
        title: def.title,
        visible: false,
        outFields: ["*"],
        definitionExpression: FOREST_FILTER,
        renderer: renderer(def),
        popupTemplate: new PopupTemplate({
          title: "{expression/title}",
          expressionInfos: [{ name: "title", expression: TITLES[def.titleKey] }],
          content: [new ExpressionContent({ expressionInfo: { expression: adaptPopup(def.popup, def.key), title: def.title } })],
        }),
      }),
  );
  return new GroupLayer({ title: CONFIG.forestGroupTitle, visible: true, visibilityMode: "independent", layers });
}

/** Documents table (read by the popups through FeatureSetByName). */
export function buildDocumentsTable(): FeatureLayer {
  return new FeatureLayer({ url: `${CONFIG.forestServiceUrl}/7`, title: DOCS_TABLE_TITLE, outFields: ["*"] });
}

/** Replace the legacy layers of the web map by the forest group at the same position. */
export function installForestLayers(map: Map): GroupLayer {
  const group = buildForestGroup();
  let index = -1;
  for (const title of CONFIG.replacedLayerTitles) {
    const layer = map.allLayers.find((l) => l.title === title);
    if (!layer) continue;
    const parent = (layer as unknown as { parent?: { layers?: __esriCollection } }).parent;
    const collection = parent?.layers ?? map.layers;
    const i = collection.indexOf(layer);
    if (index < 0) index = i;
    collection.remove(layer);
  }
  map.layers.add(group, index >= 0 ? Math.min(index, map.layers.length) : undefined);
  map.tables.add(buildDocumentsTable());
  return group;
}

type __esriCollection = { indexOf(item: unknown): number; remove(item: unknown): void };
