/**
 * Display names of the forest-governance layers and zoning classes.
 * The layers' `title` values stay fixed English strings because the Arcade popups find related layers by title;
 * these labels are what the layer list, legend and UI show.
 */
import type { Lang } from "./index";

type L = { en: string; fr: string };

export const FOREST_GROUP_LABEL: L = { en: "Other areas of interest", fr: "Autres zones d'intérêt" };

export const FOREST_LAYER_LABELS: Record<string, L> = {
  concession_zoning: { en: "Logging concessions – zoning", fr: "Concessions forestières – zonage" },
  concessions: { en: "Logging concessions – limits", fr: "Concessions forestières – limites" },
  local_territory_zoning: { en: "Local territories – zoning", fr: "Terroirs villageois – zonage" },
  local_territories: { en: "Local territories – limits", fr: "Terroirs villageois – limites" },
  protected_areas: { en: "Protected areas", fr: "Aires protégées" },
  community_forest_zoning: { en: "Community forests – zoning", fr: "Forêts communautaires – zonage" },
  community_forests: { en: "Community forests – limits", fr: "Forêts communautaires – limites" },
};

/** zone_type_std value → label (the Arcade symbology expression returns the French label; renderer values stay French). */
export const ZONE_CLASS_LABELS: Array<{ value: string; color: string; label: L }> = [
  { value: "Production (exploitation ligneuse)", color: "#c98a2b", label: { en: "Production (timber)", fr: "Production (exploitation ligneuse)" } },
  { value: "Conservation", color: "#2e7d32", label: { en: "Conservation", fr: "Conservation" } },
  { value: "Protection", color: "#00695c", label: { en: "Protection", fr: "Protection" } },
  { value: "Développement rural / communautaire", color: "#a0522d", label: { en: "Rural / community development", fr: "Développement rural / communautaire" } },
  { value: "Agriculture et agroforesterie", color: "#d4b106", label: { en: "Agriculture and agroforestry", fr: "Agriculture et agroforesterie" } },
  { value: "Habitat", color: "#8d6e63", label: { en: "Settlements", fr: "Habitat" } },
  { value: "Mise en défens / reboisement", color: "#7cb342", label: { en: "Set-aside / reforestation", fr: "Mise en défens / reboisement" } },
  { value: "Zone concédée (titres tiers)", color: "#5d4037", label: { en: "Conceded area (third-party titles)", fr: "Zone concédée (titres tiers)" } },
  { value: "Forêt communautaire", color: "#43a047", label: { en: "Community forest", fr: "Forêt communautaire" } },
  { value: "Zone conflictuelle", color: "#d32f2f", label: { en: "Conflict area", fr: "Zone conflictuelle" } },
  { value: "Recherche", color: "#7e57c2", label: { en: "Research", fr: "Recherche" } },
  { value: "Non classée", color: "#bdbdbd", label: { en: "Unclassified", fr: "Non classée" } },
  { value: "Autre", color: "#607d8b", label: { en: "Other", fr: "Autre" } },
];

export const ZONE_LEGEND_TITLE: L = { en: "Zoning class", fr: "Affectation" };

export function forestLayerLabel(key: string, lang: Lang): string {
  return FOREST_LAYER_LABELS[key]?.[lang] ?? key;
}
