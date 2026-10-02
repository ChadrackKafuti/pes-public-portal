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
  "local_governance",
];

export const GOV_LAYER_LABELS: Record<GovLayerKey, { en: string; fr: string }> = {
  protected_areas: { en: "Protected areas", fr: "Aires protégées" },
  concessions: { en: "Logging concessions – limits", fr: "Concessions forestières – limites" },
  concession_zoning: { en: "Logging concessions – zoning", fr: "Concessions forestières – zonage" },
  community_forests: { en: "Community forests – limits", fr: "Forêts communautaires – limites" },
  community_forest_zoning: { en: "Community forests – zoning", fr: "Forêts communautaires – zonage" },
  local_territories: { en: "Local territories – limits", fr: "Terroirs villageois – limites" },
  local_territory_zoning: { en: "Local territories – zoning", fr: "Terroirs villageois – zonage" },
  local_governance: { en: "Local governance body", fr: "Organes locaux de gouvernance (CLD)" },
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
  local_governance: "#ab47bc",
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

/** Protected-area designation palette (symbology_protected_areas.arcade). */
export const PA_TYPES: Record<string, { color: string; en: string; fr: string }> = {
  national_park: { color: "#1b5e20", en: "National park", fr: "Parc national" },
  world_heritage: { color: "#4a148c", en: "World heritage", fr: "Patrimoine mondial" },
  biosphere_reserve: { color: "#00695c", en: "Biosphere reserve", fr: "Réserve de biosphère" },
  ramsar: { color: "#0277bd", en: "Ramsar site", fr: "Site Ramsar" },
  sanctuary: { color: "#2e7d32", en: "Sanctuary", fr: "Sanctuaire" },
  wildlife_reserve: { color: "#388e3c", en: "Wildlife reserve", fr: "Réserve de faune" },
  nature_reserve: { color: "#2e7d32", en: "Nature reserve", fr: "Réserve naturelle" },
  strict_reserve: { color: "#004d40", en: "Strict nature reserve", fr: "Réserve naturelle intégrale" },
  forest_reserve: { color: "#558b2f", en: "Forest reserve", fr: "Réserve forestière" },
  community_reserve: { color: "#43a047", en: "Community reserve", fr: "Réserve communautaire" },
  hunting_zone: { color: "#8d6e63", en: "Hunting zone", fr: "Zone d'intérêt cynégétique" },
  botanical_garden: { color: "#7cb342", en: "Botanical / zoological garden", fr: "Jardin botanique / zoologique" },
  natural_monument: { color: "#6d4c41", en: "Natural monument", fr: "Monument naturel" },
  marine_protected_area: { color: "#01579b", en: "Marine protected area", fr: "Aire marine protégée" },
  other_protected_area: { color: "#607d8b", en: "Other protected area", fr: "Autre aire protégée" },
};

/** Proposed (not yet designated) protected areas — symbology arcade. */
export const PA_PROPOSED = {
  color: "#90a4ae",
  en: "Proposed (not yet designated)",
  fr: "Proposée (non encore désignée)",
};

/** Attribution-status palette for concessions and community forests
 *  (symbology_status.arcade labels; colours chosen on its semantics). */
export const STATUS_TYPES: Record<string, { color: string; en: string; fr: string }> = {
  attributed: { color: "#2e7d32", en: "Attributed", fr: "Attribuée" },
  final: { color: "#1b5e20", en: "Final agreement", fr: "Convention définitive" },
  provisional: { color: "#f9a825", en: "Provisional agreement", fr: "Convention provisoire" },
  in_process: { color: "#0277bd", en: "Under review", fr: "En cours d'instruction" },
  not_attributed: { color: "#90a4ae", en: "Not attributed", fr: "Non attribuée" },
  rejected: { color: "#c62828", en: "Rejected", fr: "Rejetée" },
  expired: { color: "#6d4c41", en: "Expired / terminated", fr: "Expirée / résiliée" },
  unknown: { color: "#607d8b", en: "Status not provided", fr: "Statut non renseigné" },
};

function paColorExpression(): unknown[] {
  const match: unknown[] = ["match", ["get", "subTypeStd"]];
  for (const [k, v] of Object.entries(PA_TYPES)) {
    match.push(k, v.color);
  }
  match.push(PA_TYPES.other_protected_area.color);
  return ["case", ["==", ["get", "statusStd"], "in_process"], PA_PROPOSED.color, match];
}

function statusColorExpression(): unknown[] {
  const expr: unknown[] = ["match", ["get", "statusStd"]];
  for (const [k, v] of Object.entries(STATUS_TYPES)) {
    if (k !== "unknown") expr.push(k, v.color);
  }
  expr.push(STATUS_TYPES.unknown.color);
  return expr;
}

export function govFillColor(key: GovLayerKey): unknown {
  if (GOV_ZONING_LAYERS.includes(key)) return zoneTypeColorExpression();
  // M16 — Arcade-parity unique-value renderers for the limit layers.
  if (key === "protected_areas") return paColorExpression();
  if (key === "concessions" || key === "community_forests") return statusColorExpression();
  return GOV_LIMIT_COLORS[key] ?? "#787878";
}

/** Per-layer outline accents (popup palette) — the old flat grey hid the
 *  limits on imagery (M16). */
export const GOV_LINE_COLORS: Record<string, string> = {
  protected_areas: "#1b5e20",
  concessions: "#5d4037",
  community_forests: "#1b5e20",
  local_territories: "#37474f",
  local_governance: "#6a1b9a",
};

export function govLineColor(key: GovLayerKey): string {
  return GOV_LINE_COLORS[key] ?? "#4b4b4b";
}
