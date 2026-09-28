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
