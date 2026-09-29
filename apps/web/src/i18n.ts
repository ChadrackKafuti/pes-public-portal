import { create } from "zustand";
import type { Locale } from "@cafi/shared";

/** Minimal typed i18n, same shape as portal-v1's: en is the key source. */
const en = {
  nav_applications: "Applications",
  nav_map: "Map",
  nav_runs: "Pipeline",
  search_placeholder: "Search id / application / contract code…",
  th_application: "Application",
  th_contract: "Contract",
  th_activity: "Activity",
  th_date: "Date",
  th_area: "Area (ha)",
  th_tree_cover: "Tree cover (ha)",
  th_status: "Status",
  th_visits: "Visits",
  all_activities: "All activities",
  all_countries: "All countries",
  all_provinces: "All provinces",
  all_organisations: "All organisations",
  all_projects: "All projects",
  th_location: "Location",
  th_organisation: "Organisation",
  all_statuses: "All statuses",
  no_results: "No applications match.",
  not_measured: "not measured",
  loading: "Loading…",
  error_load: "Could not load data — is the API running?",
  dossier_title: "Application dossier",
  kpi_parcel_area: "Parcel area",
  kpi_tree_cover: "Tree cover at last visit",
  kpi_defor_baseline: "Baseline deforestation",
  kpi_defor_current: "Loss since application",
  per_year: "/yr",
  chart_tree_cover: "Tree cover by visit (ha)",
  tbl_indicator: "Indicator",
  tbl_baseline: "Baseline (5 yr before application)",
  tbl_current: "Since application",
  ind_defor: "Deforestation (ha)",
  ind_defor_alerts: "Deforestation alerts (RADD)",
  ind_fire_alerts: "Fire alerts (VIIRS)",
  ind_burned: "Burned area (ha)",
  visit: "Visit",
  application: "Application",
  runs_title: "Pipeline runs",
  blank_hint: "— means not measured (a failed or unavailable indicator), never zero.",
  open_dossier: "Open dossier",
  map_find_placeholder: "Find a parcel by code…",
  map_no_match: "No match",
  basemap_imagery: "Imagery",
  basemap_streets: "Streets",
  sign_in: "Sign in",
  sign_out: "Sign out",
  signin_hint: "Staff and verifier access. Sign in with your PES account.",
  export_csv: "Export CSV",
  export_pdf: "Print / PDF",
  gov_layers: "Governance layers",
  gov_documents: "Documents",
  gov_zone_legend: "Zoning class",
  signin_hint_supabase: "Staff and verifier access. Sign in with your CAFI platform account.",
  email: "Email",
  password: "Password",
  demo_badge: "DEMO",
  demo_hint: "Demo snapshot: real forest-governance layers, sample PES applications. Not live data.",
} as const;

type Key = keyof typeof en;

const fr: Record<Key, string> = {
  nav_applications: "Demandes",
  nav_map: "Carte",
  nav_runs: "Pipeline",
  search_placeholder: "Rechercher id / code demande / code contrat…",
  th_application: "Demande",
  th_contract: "Contrat",
  th_activity: "Activité",
  th_date: "Date",
  th_area: "Superficie (ha)",
  th_tree_cover: "Couvert arboré (ha)",
  th_status: "Statut",
  th_visits: "Visites",
  all_activities: "Toutes les activités",
  all_countries: "Tous les pays",
  all_provinces: "Toutes les provinces",
  all_organisations: "Toutes les organisations",
  all_projects: "Tous les projets",
  th_location: "Localisation",
  th_organisation: "Organisation",
  all_statuses: "Tous les statuts",
  no_results: "Aucune demande ne correspond.",
  not_measured: "non mesuré",
  loading: "Chargement…",
  error_load: "Impossible de charger les données — l'API est-elle démarrée ?",
  dossier_title: "Dossier de la demande",
  kpi_parcel_area: "Superficie de la parcelle",
  kpi_tree_cover: "Couvert arboré à la dernière visite",
  kpi_defor_baseline: "Déforestation de référence",
  kpi_defor_current: "Perte depuis la demande",
  per_year: "/an",
  chart_tree_cover: "Couvert arboré par visite (ha)",
  tbl_indicator: "Indicateur",
  tbl_baseline: "Référence (5 ans avant la demande)",
  tbl_current: "Depuis la demande",
  ind_defor: "Déforestation (ha)",
  ind_defor_alerts: "Alertes de déforestation (RADD)",
  ind_fire_alerts: "Alertes de feux (VIIRS)",
  ind_burned: "Superficie brûlée (ha)",
  visit: "Visite",
  application: "Demande",
  runs_title: "Exécutions du pipeline",
  blank_hint: "— signifie non mesuré (indicateur en échec ou indisponible), jamais zéro.",
  open_dossier: "Ouvrir le dossier",
  map_find_placeholder: "Trouver une parcelle par code…",
  map_no_match: "Aucun résultat",
  basemap_imagery: "Imagerie",
  basemap_streets: "Rues",
  sign_in: "Se connecter",
  sign_out: "Se déconnecter",
  signin_hint: "Accès personnel et vérificateurs. Connectez-vous avec votre compte PES.",
  export_csv: "Exporter CSV",
  export_pdf: "Imprimer / PDF",
  gov_layers: "Couches de gouvernance",
  gov_documents: "Documents",
  gov_zone_legend: "Affectation",
  signin_hint_supabase: "Accès personnel et vérificateurs. Connectez-vous avec votre compte plateforme CAFI.",
  email: "E-mail",
  password: "Mot de passe",
  demo_badge: "DÉMO",
  demo_hint: "Instantané de démonstration : couches de gouvernance réelles, dossiers PES fictifs. Données non actualisées.",
};

const dictionaries: Record<Locale, Record<Key, string>> = { en, fr };

interface I18nState {
  locale: Locale;
  setLocale: (l: Locale) => void;
}

export const useI18n = create<I18nState>((set) => ({
  locale: (navigator.language?.startsWith("fr") ? "fr" : "en") as Locale,
  setLocale: (locale) => set({ locale }),
}));

export function useT() {
  const locale = useI18n((s) => s.locale);
  return (key: Key) => dictionaries[locale][key];
}

export function fmtNum(value: number | null | undefined, locale: Locale, digits = 1): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString(locale === "fr" ? "fr-FR" : "en-GB", {
    maximumFractionDigits: digits,
  });
}

export function fmtDate(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
