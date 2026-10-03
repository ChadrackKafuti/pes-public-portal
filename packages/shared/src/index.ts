/**
 * Shared types for the CAFI RS Platform.
 *
 * The indicator types mirror the main output table of the PES Remote-Sensing
 * Integration specification v1.1 (§6.1, `pes_rs_objects`) — one row per
 * application or monitoring visit. Field semantics, including "blank is not
 * zero", follow the spec.
 */

export type ObjectType = "application" | "monitoring_visit";

export type GeomSource =
  | "polygon"
  | "buffered_point"
  | "polygon_inherited"
  | "buffered_point_inherited";

export type ProcessingStatus = "ok" | "partial" | "partial_final";

/** One row of `pes_rs_objects`. `null` means "not measured" (spec §7), never zero. */
export interface PesRsObject {
  objectId: string;
  objectDate: string; // ISO date
  objectType: ObjectType;
  applicationCode: string | null;
  contractCode: string | null;
  pesActivity: string | null;
  parcelAreaHa: number;
  treeCoverHa: number | null;
  defor5yrHaYr: number | null;
  deforCurrentHa: number | null;
  deforAlerts5yr: number | null;
  deforAlertsCurrent: number | null;
  fireAlerts5yr: number | null;
  fireAlertsCurrent: number | null;
  burnedArea5yrHa: number | null;
  burnedAreaCurrentHa: number | null;
  currentStart: string | null; // application date; null for applications
  geomSource: GeomSource;
  tcWindowDays: number | null;
  tcCoverage: number | null; // 0..1 fraction of parcel observed
  baselineYears: number | null;
  status: ProcessingStatus;
  failedIndicators: string[];
  processedUtc: string;
}

/** Spec §6.2 — records that could not be processed. */
export type ExceptionReason =
  | "no_usable_geometry"
  | "oversize_gt_5000ha"
  | "bad_object_date"
  | "geometry_too_complex"
  | "own_failed"
  | "parent_failed";

/** One row of GET /api/applications. */
export interface ApplicationSummary {
  applicationId: string;
  applicationCode: string | null;
  contractCode: string | null;
  applicationDate: string;
  pesActivity: string | null;
  country: string | null;
  province: string | null;
  implementingOrg: string | null;
  projectName: string | null;
  estimatedAreaHa: number | null;
  parcelAreaHa: number | null;
  treeCoverHa: number | null;
  defor5yrHaYr: number | null;
  status: string | null;
  visitCount: number;
  lastProcessedUtc: string | null;
}

export interface ApplicationList {
  items: ApplicationSummary[];
  total: number;
}

export interface FilterOptions {
  countries: string[];
  provinces: string[];
  organisations: string[];
  projects: string[];
  activities: string[];
}

export interface RunHealth {
  runId: number;
  startUtc: string;
  endUtc: string | null;
  durationS: number | null;
  fetchedApp: number | null;
  fetchedMon: number | null;
  selected: number | null;
  ok: number | null;
  partial: number | null;
  skipped: number | null;
  queued: number | null;
  stoppedReason: string | null;
}

export interface ContractSummary {
  contractCode: string;
  projectName: string | null;
  implementingOrgName: string | null;
  country: string | null;
  province: string | null;
  activityType: string | null;
  beneficiaryType: string | null;
  contractedPesAreaHa: number | null;
  contractStartDate: string | null;
  contractEndDate: string | null;
}

export type Locale = "en" | "fr";

/** One forest-governance layer's production-filtered inventory. */
export interface GovLayerInfo {
  layer: GovLayerKey;
  total: number;
  byCountry: Record<string, number>;
  lastLoadedUtc: string | null;
}

export type GovLayerKey =
  | "protected_areas"
  | "concessions"
  | "concession_zoning"
  | "community_forests"
  | "community_forest_zoning"
  | "local_territories"
  | "local_territory_zoning"
  | "local_governance";

/** M20 — one skipped/failed parcel on the admin follow-up page. */
export interface AdminExceptionItem {
  objectId: string;
  objectType: string | null;
  reason: string;
  areaGis: number | null;
  occurrences: number;
  lastSeen: string | null;
  applicationCode: string | null;
  implementingOrg: string | null;
  country: string | null;
}

export interface AdminExceptions {
  summary: { reason: string; objects: number }[];
  items: AdminExceptionItem[];
}

/** One gov_documents row (public link). */
export interface GovDocument {
  docUid: string;
  title: string | null;
  categoryStd: string | null;
  fileName: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  dateDoc: string | null;
  url: string | null;
  srcSystem: string | null;
}

/** M5 dashboard payload. */
export interface Dashboard {
  pes: {
    applications: number;
    parcelAreaHa: number | null;
    treeCoverHa: number | null;
    visits: number;
    statusCounts: { ok: number; partial: number; partialFinal: number };
    byCountry: DashboardGroup[];
    byActivity: DashboardGroup[];
    byMonth: { month: string; applications: number }[];
    /** M7e — v1 country-overview aggregates (absent until raw records mirror). */
    byStage?: { name: string; order: number | null; applications: number }[];
    byGender?: { name: string; applications: number }[];
    fireProfile?: { name: string; applications: number }[];
    overdue?: number | null;
  };
  governance: {
    byLayer: { layer: GovLayerKey; count: number; areaHa: number | null }[];
    documents: number;
  };
}

export interface DashboardGroup {
  name: string;
  applications: number;
  areaHa: number | null;
}

/** M7d — contract analyses (v1 contract-analysis page). */
export interface AnalysesContract {
  contractCode: string;
  /** Display code until real contract codes ship (CO54-BE113 style). */
  applicationCode?: string | null;
  org: string | null;
  project: string | null;
  country: string | null;
  village: string | null;
  activity: string | null;
  applications: number;
  estimatedAreaHa: number | null;
  firstDate: string | null;
}

export interface ContractAnalysis {
  contractCode: string;
  org: string | null;
  project: string | null;
  country: string | null;
  village: string | null;
  activity: string | null;
  applications: number;
  parcelAreaHa: number | null;
  contractedAreaHa: number | null;
  beneficiaryType: string | null;
  startDate: string | null;
  endDate: string | null;
  series: { year: number; tcHa: number | null; lossHa: number | null }[];
}

/** M7b — the application profile (v1 popup content, section by section). */
export interface Profile {
  applicationId: string;
  applicationCode: string | null;
  applicationDate: string | null;
  activity: string | null;
  activityGroup: "generic" | "agroforestry" | "reforestation" | "natural_regeneration";
  stage: {
    name: string | null;
    order: number | null;
    total: number;
    category: "active" | "rejected" | "archived" | "unknown";
    status: string | null;
  } | null;
  location: {
    country: string | null;
    province: string | null;
    territory: string | null;
    village: string | null;
  };
  beneficiary: {
    type: string | null;
    status: string | null;
    gender: string | null;
    familySituation: string | null;
    dependents: number | null;
    communityMembers: number | null;
  } | null;
  project: {
    name: string | null;
    org: string | null;
    orgAcronym: string | null;
    aggregator: string | null;
  };
  contract: {
    code: string | null;
    status: string | null;
    start: string | null;
    end: string | null;
    durationYears: number | null;
    declaredAreaHa: number | null;
    contractedAreaHa: number | null;
    pctElapsed: number | null;
    daysRemaining: number | null;
    species: { name: string | null; densityPerHa: number | null }[];
  } | null;
  visits: {
    expected: number | null;
    completed: number;
    lastDate: string | null;
    nextDue: string | null;
    overdue: boolean | null;
  } | null;
  fire: {
    burned5yrHa: number | null;
    burnedPct: number | null;
    fireAlerts5yr: number | null;
    category: "low" | "moderate" | "high" | "very_high" | null;
  } | null;
  performance: {
    achievedHa: number | null;
    gapHa: number | null;
    achievedPct: number | null;
    monitoredTotalHa: number | null;
    observedTrees: number | null;
    observedLandCover: string | null;
    observedLandCoverPct: number | null;
  } | null;
  areas: {
    estimatedHa: number | null;
    declaredHa: number | null;
    contractedHa: number | null;
    achievedHa: number | null;
  };
  baseline?: {
    parcelAreaHa: number | null;
    treeCoverHa: number | null;
    defor5yrHaYr: number | null;
    baselineYears: number | null;
    landcoverAtApp: string | null;
    landcoverAtAppPct: number | null;
    landcoverCurrent: string | null;
    landcoverCurrentPct: number | null;
    landcoverChanged: boolean | null;
    series?: { year: number; tcHa: number | null; lossHa: number | null }[];
  } | null;
  geometrySource: string | null;
  lastSync: string | null;
}

/** One geotagged photo point (M7a). Image via /api/photos/{uid}/image-url. */
export interface Photo {
  photoUid: string;
  kind: "application" | "monitoring_visit";
  parentId: string | null;
  applicationId: string | null;
  applicationCode: string | null;
  contractCode: string | null;
  photoIndex: number | null;
  label: string | null;
  lon: number;
  lat: number;
  mirrored: boolean;
}

/** One governance feature intersecting a drawn AOI (M3). */
export interface AoiOverlap {
  layer: GovLayerKey;
  srcUid: string;
  name: string | null;
  reference: string | null;
  iso3: string | null;
  docCount: number | null;
  overlapHa: number;
  overlapPct: number;
}

/** POST /api/aoi answer: what governs the drawn polygon. */
export interface AoiResult {
  areaHa: number;
  overlaps: AoiOverlap[];
  byLayer: Partial<Record<GovLayerKey, number>>;
}

/** One monitoring visit with an active disturbance signal (M4 alert feed). */
export interface AlertRow {
  objectId: string;
  objectDate: string;
  applicationId: string;
  applicationCode: string | null;
  contractCode: string | null;
  pesActivity: string | null;
  country: string | null;
  province: string | null;
  deforAlertsCurrent: number | null;
  fireAlertsCurrent: number | null;
  deforCurrentHa: number | null;
  burnedAreaCurrentHa: number | null;
  processedUtc: string;
}
