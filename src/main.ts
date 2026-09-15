// Styles
import "@esri/calcite-components/main.css";
import "@arcgis/map-components/main.css";
import "./style.css";

// Calcite components (side-effect registration)
import "@esri/calcite-components/components/calcite-shell";
import "@esri/calcite-components/components/calcite-shell-panel";
import "@esri/calcite-components/components/calcite-navigation";
import "@esri/calcite-components/components/calcite-navigation-logo";
import "@esri/calcite-components/components/calcite-menu";
import "@esri/calcite-components/components/calcite-menu-item";
import "@esri/calcite-components/components/calcite-panel";
import "@esri/calcite-components/components/calcite-tabs";
import "@esri/calcite-components/components/calcite-tab-nav";
import "@esri/calcite-components/components/calcite-tab-title";
import "@esri/calcite-components/components/calcite-tab";
import "@esri/calcite-components/components/calcite-block";
import "@esri/calcite-components/components/calcite-label";
import "@esri/calcite-components/components/calcite-combobox";
import "@esri/calcite-components/components/calcite-combobox-item";
import "@esri/calcite-components/components/calcite-input";
import "@esri/calcite-components/components/calcite-input-date-picker";
import "@esri/calcite-components/components/calcite-button";
import "@esri/calcite-components/components/calcite-segmented-control";
import "@esri/calcite-components/components/calcite-segmented-control-item";
import "@esri/calcite-components/components/calcite-notice";
import "@esri/calcite-components/components/calcite-link";

// Map components
import "@arcgis/map-components/components/arcgis-map";
import "@arcgis/map-components/components/arcgis-zoom";
import "@arcgis/map-components/components/arcgis-home";
import "@arcgis/map-components/components/arcgis-scale-bar";
import "@arcgis/map-components/components/arcgis-layer-list";
import "@arcgis/map-components/components/arcgis-legend";
import "@arcgis/map-components/components/arcgis-feature";

import { CONFIG } from "./config";
import { applyTranslations, initLang, setLang, t, type Lang } from "./i18n";
import { MapPage } from "./pages/mapPage";
import { AnalysesPage } from "./pages/analysesPage";
import { AlertsPage } from "./pages/alertsPage";

// The default portal (www.arcgis.com) stays: geosmart.undp.org blocks cross-origin portal requests, so web maps
// are loaded from JSON snapshots (see src/webmap.ts) and layers directly from the hosting server.

const pages = {
  map: new MapPage(),
  analyses: new AnalysesPage(),
  alerts: new AlertsPage(),
};
type PageId = keyof typeof pages;

function currentPage(): PageId {
  const id = location.hash.replace(/^#\/?/, "").split("/")[0];
  return id in pages ? (id as PageId) : "map";
}

function route(): void {
  const id = currentPage();
  document.querySelectorAll<HTMLElement>(".page").forEach((p) => {
    p.hidden = p.dataset.page !== id;
  });
  document.querySelectorAll<HTMLCalciteMenuItemElement>("#nav calcite-menu-item").forEach((item) => {
    item.active = item.dataset.page === id;
  });
  pages[id].start();
  window.dispatchEvent(new Event("resize"));
}

function initLanguageSwitch(lang: Lang): void {
  const control = document.querySelector<HTMLCalciteSegmentedControlElement>("#lang")!;
  control.querySelectorAll<HTMLCalciteSegmentedControlItemElement>("calcite-segmented-control-item").forEach((item) => {
    item.checked = item.value === lang;
  });
  control.addEventListener("calciteSegmentedControlChange", () => {
    setLang((control.selectedItem?.value as Lang) ?? "en");
  });
}

function initLinks(): void {
  const survey = document.querySelector<HTMLCalciteLinkElement>("#link-survey")!;
  if (CONFIG.links.survey) survey.href = CONFIG.links.survey;
  else survey.hidden = true;
  document.querySelector<HTMLElement>("#app-version")!.textContent = CONFIG.appVersion;
}

/** On narrow screens the header keeps only the title so the page menu and language switch stay visible. */
function fitHeader(): void {
  const logo = document.querySelector<HTMLCalciteNavigationLogoElement>("calcite-navigation-logo")!;
  const narrow = window.matchMedia("(max-width: 760px)").matches;
  logo.description = narrow ? "" : t("app.subtitle");
}

const lang = initLang();
document.documentElement.lang = lang;
applyTranslations(document);
initLanguageSwitch(lang);
initLinks();
fitHeader();
window.addEventListener("resize", fitHeader);
document.addEventListener("pes-lang-change", fitHeader);
window.addEventListener("hashchange", route);
if (!location.hash) location.replace("#/map");
route();
