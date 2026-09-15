/**
 * Application configuration: portal, web maps, layers and filters.
 * Everything that points at the GIS portal lives here so the app can be re-pointed without code changes.
 */

import webmapsConfig from "../webmaps.config.json";

export interface FilterDef {
  /** stable id used for i18n keys (filter.<id>) */
  id: string;
  /** field names to look for on each layer, in order of preference (case-insensitive) */
  fields: string[];
  /** when true the option list is refreshed when the "country" filter changes */
  cascadesOnCountry?: boolean;
}

export const CONFIG = {
  appVersion: "1.0.0",

  /**
   * Public web maps (item ids in webmaps.config.json). Content, symbology and popups are managed in the portal;
   * scripts/fetch-webmap.mjs snapshots their JSON into public/webmaps because the portal blocks cross-origin reads.
   */
  webmaps: webmapsConfig.items as { map: string; analyses: string },

  /** Initial map extent (WGS84). null = use the web map's own initial extent. */
  initialExtent: { xmin: 5, ymin: -14, xmax: 32, ymax: 12 } as { xmin: number; ymin: number; xmax: number; ymax: number } | null,

  /** Feature layers of the web map that receive the filters (matched on their service URL). */
  filterableLayerPattern: /\/Hosted\/PES_API_/i,
  /** Layer used to build the filter option lists and the match count. */
  applicationsLayerPattern: /Applications_Points/i,

  /** Filters shown in the Map page, in this order. */
  filters: [
    { id: "country", fields: ["country"] },
    { id: "province", fields: ["province"], cascadesOnCountry: true },
    { id: "organisation", fields: ["implementingorgname"] },
    { id: "project", fields: ["projectname"] },
    { id: "activity", fields: ["activitytype"] },
    { id: "beneficiaryType", fields: ["beneficiarytype"] },
    { id: "gender", fields: ["beneficiarygender"] },
    { id: "status", fields: ["applicationstatus", "contractstatus"] },
  ] as FilterDef[],
  /** Fields searched by the "code" box (applications, contracts, photos). */
  codeFields: ["applicationcode", "contractcode", "parentrecordid"],
  /** Date field used by the period filter, per layer, first match wins. */
  dateFields: ["applicationdate", "monitoringdate", "contractstartdate"],

  /** Analyses page sources. */
  contractsLayerUrl:
    "https://geosmarthosting.undp.org/arcgis/rest/services/Hosted/PES_API_Data_Contracts_Prod_view/FeatureServer/0",
  contractFields: {
    code: "contractcode",
    organisation: "implementingorgname",
    acronym: "implementingorgacronym",
    project: "projectname",
    village: "village",
    country: "country",
    province: "province",
    beneficiaryType: "beneficiarytype",
    activity: "activitytype",
    contractedArea: "contractedpesarea",
    start: "contractstartdate",
    end: "contractenddate",
  },
  analysisTableUrl:
    "https://geosmarthosting.undp.org/arcgis/rest/services/Hosted/PES_contracts_analysis_sheet_view/FeatureServer/0",
  analysisFields: {
    contract: "safe1", // ContractCode
    year: "year_",
    treeCover: "tc_ha", // hectares of tree cover
    treeCoverLoss: "safe3", // hectares of tree cover loss (same field as the Experience Builder chart)
    parcelArea: "parcel_area_ha",
  },

  /** Optional external links (hidden when empty). */
  links: {
    survey: "", // Survey123 form (the current form item is not public)
    cafi: "https://www.cafi.org/",
    undp: "https://www.undp.org/",
  },

  /** Key-free basemaps offered in the basemap panel (the web map's own basemap is always the first choice). */
  basemaps: [
    { id: "topo", labelKey: "basemap.topo", url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer" },
    { id: "streets", labelKey: "basemap.streets", url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer" },
    { id: "osm", labelKey: "basemap.osm", url: "osm" },
  ],
};
