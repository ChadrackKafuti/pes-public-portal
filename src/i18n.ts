/** Minimal EN/FR dictionary. Static markup uses data-i18n attributes; code uses t(). */

export type Lang = "en" | "fr";

const dict: Record<Lang, Record<string, string>> = {
  en: {
    "app.title": "PES GIS Portal",
    "app.subtitle": "Payments for Environmental Services in the Congo Basin",
    "nav.map": "Map",
    "nav.analyses": "Analyses",
    "nav.alerts": "Alerts",
    "footer.version": "Version",
    "footer.data": "Data: CAFI PES production API, WDPA, national forest atlases. Basemap: Esri World Imagery.",
    "panel.filters": "Filters",
    "panel.layers": "Layers",
    "panel.legend": "Legend",
    "panel.info": "Feature info",
    "panel.basemap": "Basemap",
    "filter.country": "Country",
    "filter.province": "Province",
    "filter.organisation": "Organisation",
    "filter.project": "Project",
    "filter.activity": "PES activity type",
    "filter.beneficiaryType": "Beneficiary type",
    "filter.gender": "Beneficiary gender",
    "filter.status": "Application / contract status",
    "filter.code": "Application or contract code",
    "filter.codePlaceholder": "e.g. CMR-556",
    "filter.period": "Period",
    "filter.from": "From",
    "filter.to": "To",
    "filter.any": "All",
    "filter.apply": "Apply",
    "filter.reset": "Reset",
    "filter.matches": "{n} applications match the current filters",
    "filter.loading": "Loading filter values…",
    "info.empty": "Click an application, contract, monitoring visit or photo on the map to see its details here.",
    "basemap.webmap": "Imagery (web map default)",
    "basemap.topo": "Topographic",
    "basemap.streets": "Streets",
    "basemap.osm": "OpenStreetMap",
    "analyses.heading": "Contract analysis",
    "analyses.select": "Select a contract",
    "analyses.organisation": "Organisation",
    "analyses.project": "Project",
    "analyses.contract": "Contract",
    "analyses.empty": "Select a contract to start.",
    "analyses.loading": "Loading analysis…",
    "analyses.noData": "No annual analysis is available yet for this contract.",
    "analyses.treeCover": "Tree cover",
    "analyses.treeCoverShare": "of the contracted area",
    "analyses.treeCoverLoss": "Tree cover loss",
    "analyses.inYear": "in {year}",
    "analyses.chartTreeCover": "Tree cover (ha) per year",
    "analyses.chartLoss": "Tree cover loss (ha) per year",
    "analyses.source": "Source: Brown, C.F. et al. Dynamic World, near real-time global 10 m land use land cover mapping. Sci Data 9, 251 (2022).",
    "analyses.description": "Description",
    "analyses.descriptionText":
      "Contract {code}, signed with a {beneficiary} in {village} ({country}), covers {area} ha of {activity}, implemented by {org} from {start} to {end}.",
    "analyses.table": "Data table",
    "analyses.year": "Year",
    "analyses.comingSoon": "Under development",
    "analyses.comingSoonList": "Fire alerts, deforestation alerts, canopy height, burned areas, biomass density, vegetation indices.",
    "alerts.heading": "Alerts",
    "alerts.text":
      "This page will list the PES contracts where monitoring detected an alert (fire, deforestation, burned areas). It is under development.",
    "alerts.soon": "Coming soon",
    "map.loadError": "The map could not be loaded. Check your connection and try again.",
    "unit.ha": "ha",
  },
  fr: {
    "app.title": "Portail SIG PSE",
    "app.subtitle": "Paiements pour services environnementaux dans le bassin du Congo",
    "nav.map": "Carte",
    "nav.analyses": "Analyses",
    "nav.alerts": "Alertes",
    "footer.version": "Version",
    "footer.data": "Données : API de production PSE CAFI, WDPA, atlas forestiers nationaux. Fond de carte : Esri World Imagery.",
    "panel.filters": "Filtres",
    "panel.layers": "Couches",
    "panel.legend": "Légende",
    "panel.info": "Informations",
    "panel.basemap": "Fond de carte",
    "filter.country": "Pays",
    "filter.province": "Province",
    "filter.organisation": "Organisation",
    "filter.project": "Projet",
    "filter.activity": "Type d'activité PSE",
    "filter.beneficiaryType": "Type de bénéficiaire",
    "filter.gender": "Genre du bénéficiaire",
    "filter.status": "Statut de la demande / du contrat",
    "filter.code": "Code de la demande ou du contrat",
    "filter.codePlaceholder": "ex. CMR-556",
    "filter.period": "Période",
    "filter.from": "Du",
    "filter.to": "Au",
    "filter.any": "Tous",
    "filter.apply": "Appliquer",
    "filter.reset": "Réinitialiser",
    "filter.matches": "{n} demandes correspondent aux filtres",
    "filter.loading": "Chargement des valeurs…",
    "info.empty": "Cliquez sur une demande, un contrat, une visite de suivi ou une photo sur la carte pour afficher ses détails ici.",
    "basemap.webmap": "Imagerie (fond par défaut)",
    "basemap.topo": "Topographique",
    "basemap.streets": "Rues",
    "basemap.osm": "OpenStreetMap",
    "analyses.heading": "Analyse du contrat",
    "analyses.select": "Sélectionner un contrat",
    "analyses.organisation": "Organisation",
    "analyses.project": "Projet",
    "analyses.contract": "Contrat",
    "analyses.empty": "Sélectionnez un contrat pour commencer.",
    "analyses.loading": "Chargement de l'analyse…",
    "analyses.noData": "Aucune analyse annuelle n'est encore disponible pour ce contrat.",
    "analyses.treeCover": "Couvert arboré",
    "analyses.treeCoverShare": "de la superficie contractée",
    "analyses.treeCoverLoss": "Perte de couvert arboré",
    "analyses.inYear": "en {year}",
    "analyses.chartTreeCover": "Couvert arboré (ha) par année",
    "analyses.chartLoss": "Perte de couvert arboré (ha) par année",
    "analyses.source": "Source : Brown, C.F. et al. Dynamic World, near real-time global 10 m land use land cover mapping. Sci Data 9, 251 (2022).",
    "analyses.description": "Description",
    "analyses.descriptionText":
      "Le contrat {code}, signé avec un {beneficiary} à {village} ({country}), couvre {area} ha de {activity}, mis en œuvre par {org} du {start} au {end}.",
    "analyses.table": "Tableau des données",
    "analyses.year": "Année",
    "analyses.comingSoon": "En développement",
    "analyses.comingSoonList": "Alertes feux, alertes déforestation, hauteur de canopée, surfaces brûlées, densité de biomasse, indices de végétation.",
    "alerts.heading": "Alertes",
    "alerts.text":
      "Cette page listera les contrats PSE pour lesquels le suivi a détecté une alerte (feu, déforestation, surfaces brûlées). Elle est en développement.",
    "alerts.soon": "Bientôt disponible",
    "map.loadError": "La carte n'a pas pu être chargée. Vérifiez votre connexion et réessayez.",
    "unit.ha": "ha",
  },
};

const STORAGE_KEY = "pes-portal-lang";
let current: Lang = "en";

export function getLang(): Lang {
  return current;
}

export function initLang(): Lang {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
  const fromBrowser = navigator.language?.toLowerCase().startsWith("fr") ? "fr" : "en";
  current = saved === "fr" || saved === "en" ? saved : fromBrowser;
  return current;
}

export function setLang(lang: Lang): void {
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = lang;
  applyTranslations(document);
  document.dispatchEvent(new CustomEvent("pes-lang-change", { detail: lang }));
}

/** Translate a key; {name} placeholders are replaced from params. */
export function t(key: string, params?: Record<string, string | number>): string {
  let text = dict[current][key] ?? dict.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}

/** Apply data-i18n / data-i18n-attr="attr:key" attributes inside root. */
export function applyTranslations(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n!);
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-attr]").forEach((el) => {
    // format: "heading:panel.filters;placeholder:filter.codePlaceholder"
    for (const pair of el.dataset.i18nAttr!.split(";")) {
      const [attr, key] = pair.split(":").map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    }
  });
}

/** Locale-aware number formatting. */
export function fmtNumber(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  return new Intl.NumberFormat(current === "fr" ? "fr-FR" : "en-GB", { maximumFractionDigits: digits }).format(value);
}

export function fmtDate(ms: number | null | undefined): string {
  if (!ms) return "–";
  return new Intl.DateTimeFormat(current === "fr" ? "fr-FR" : "en-GB", { year: "numeric", month: "short", day: "numeric" }).format(
    new Date(ms),
  );
}
