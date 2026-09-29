/**
 * Forest-governance overlay metadata — the portal-v1 symbology ported from
 * the Arcade renderers (symbology_zone_type.arcade + forestLayers.ts):
 * flat colours per parent layer, unique values on zone_type_std for the
 * three zoning layers.
 */

import type { GovLayerKey, Locale } from "@cafi/shared";

export const GOV_LAYER_ORDER: GovLayerKey[] = [
  "protected_areas",
  "concessions",
  "concession_zoning",
  "community_forests",
  "community_forest_zoning",
  "local_territories",
  "local_territory_zoning",
];

export const GOV_LAYER_LABELS: Record<GovLayerKey, { en: string; fr: string }> = {
  protected_areas: { en: "Protected areas", fr: "Aires protégées" },
  concessions: { en: "Logging concessions – limits", fr: "Concessions forestières – limites" },
  concession_zoning: { en: "Logging concessions – zoning", fr: "Concessions forestières – zonage" },
  community_forests: { en: "Community forests – limits", fr: "Forêts communautaires – limites" },
  community_forest_zoning: { en: "Community forests – zoning", fr: "Forêts communautaires – zonage" },
  local_territories: { en: "Local territories – limits", fr: "Terroirs villageois – limites" },
  local_territory_zoning: { en: "Local territories – zoning", fr: "Terroirs villageois – zonage" },
};

export const GOV_ZONING_LAYERS: GovLayerKey[] = [
  "concession_zoning",
  "community_forest_zoning",
  "local_territory_zoning",
];

/** Flat fill colour of the four parent (limits) layers. */
export const GOV_LIMIT_COLORS: Record<string, string> = {
  protected_areas: "#2e7d32",
  concessions: "#cc783c",
  community_forests: "#3c965a",
  local_territories: "#5078c8",
};

/** zone_type_std -> colour + label (portal-v1 palette). */
export const ZONE_TYPES: Record<string, { color: string; en: string; fr: string }> = {
  production: { color: "#c98a2b", en: "Production (timber)", fr: "Production (exploitation ligneuse)" },
  conservation: { color: "#2e7d32", en: "Conservation", fr: "Conservation" },
  protection: { color: "#00695c", en: "Protection", fr: "Protection" },
  community_development: { color: "#a0522d", en: "Rural / community development", fr: "Développement rural / communautaire" },
  agriculture: { color: "#d4b106", en: "Agriculture and agroforestry", fr: "Agriculture et agroforesterie" },
  habitat: { color: "#8d6e63", en: "Settlements", fr: "Habitat" },
  savanna_protection: { color: "#7cb342", en: "Set-aside / reforestation", fr: "Mise en défens / reboisement" },
  concession: { color: "#5d4037", en: "Conceded area (third-party titles)", fr: "Zone concédée (titres tiers)" },
  community_forest: { color: "#43a047", en: "Community forest", fr: "Forêt communautaire" },
  conflict: { color: "#d32f2f", en: "Conflict area", fr: "Zone conflictuelle" },
  research: { color: "#7e57c2", en: "Research", fr: "Recherche" },
  unclassified: { color: "#bdbdbd", en: "Unclassified", fr: "Non classée" },
  other: { color: "#607d8b", en: "Other", fr: "Autre" },
};

export function govLayerLabel(key: GovLayerKey, locale: Locale): string {
  return GOV_LAYER_LABELS[key][locale];
}

export function zoneTypeLabel(key: string | null | undefined, locale: Locale): string {
  const z = key ? ZONE_TYPES[key] : undefined;
  return z ? z[locale] : ZONE_TYPES.unclassified[locale];
}

/** MapLibre match expression: zone_type_std -> colour. */
export function zoneTypeColorExpression(): unknown[] {
  const expr: unknown[] = ["match", ["get", "zoneTypeStd"]];
  for (const [k, v] of Object.entries(ZONE_TYPES)) {
    expr.push(k, v.color);
  }
  expr.push(ZONE_TYPES.unclassified.color);
  return expr;
}

export function govFillColor(key: GovLayerKey): unknown {
  if (GOV_ZONING_LAYERS.includes(key)) return zoneTypeColorExpression();
  return GOV_LIMIT_COLORS[key] ?? "#787878";
}
