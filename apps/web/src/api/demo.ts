/**
 * Demo mode (VITE_DEMO=1): the app runs from static JSON snapshots under
 * ./demo-data instead of the live API — used for the hosted demo build.
 * Server-side behaviours the snapshots can't replay (list filtering,
 * per-feature document lookups) are reproduced client-side here.
 */

import type { ApplicationList, ApplicationSummary, GovDocument } from "@cafi/shared";
import type { ApplicationFilters } from "./client";

export const demoEnabled = import.meta.env.VITE_DEMO === "1";

const cache = new Map<string, Promise<unknown>>();

function load<T>(file: string): Promise<T> {
  if (!cache.has(file)) {
    cache.set(
      file,
      fetch(`demo-data/${file}`).then((r) => {
        if (!r.ok) throw new Error(`${r.status} demo-data/${file}`);
        return r.json();
      }),
    );
  }
  return cache.get(file) as Promise<T>;
}

function matches(item: ApplicationSummary, f: ApplicationFilters): boolean {
  if (f.activity && item.pesActivity !== f.activity) return false;
  if (f.country && item.country !== f.country) return false;
  if (f.province && item.province !== f.province) return false;
  if (f.org && item.implementingOrg !== f.org) return false;
  if (f.project && item.projectName !== f.project) return false;
  if (f.status && item.status !== f.status) return false;
  if (f.q) {
    const q = f.q.toUpperCase();
    if (
      ![item.applicationId, item.applicationCode, item.contractCode].some(
        (v) => v && v.toUpperCase().includes(q),
      )
    ) {
      return false;
    }
  }
  return true;
}

/** Resolve an /api path against the static snapshots. */
export async function demoGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  if (path === "/applications") {
    const all = await load<ApplicationList>("applications.json");
    const items = all.items.filter((i) => matches(i, (params ?? {}) as ApplicationFilters));
    return { items, total: items.length } as T;
  }
  if (path === "/filters") return load("filters.json");
  if (path === "/dashboard") return load("dashboard.json");
  if (path === "/alerts") return load("alerts.json");
  if (path === "/health/runs") return load("runs.json");
  // Analyses: one synthetic contract so the page demonstrates itself.
  if (path === "/analyses/contracts") {
    return [
      {
        contractCode: "DEMO-CT-0001", applicationCode: "DEMO-CA1001-BE0001",
        org: "Org Demo A", project: "Project X",
        country: "DRC", village: "Kiasi", activity: "Agroforestry",
        applications: 1, estimatedAreaHa: 3.5, firstDate: "2024-06-01",
        hasSeries: true,
      },
      {
        contractCode: "DEMO-CT-0002", applicationCode: "DEMO-CA1002-BE0002",
        org: "Org Demo A", project: "Project X",
        country: "DRC", village: "Bokoro", activity: "Reforestation",
        applications: 1, estimatedAreaHa: 2.1, firstDate: "2024-05-14",
        hasSeries: false,
      },
    ] as T;
  }
  if (/^\/analyses\/contracts\//.test(path)) {
    return {
      contractCode: "DEMO-CT-0001", org: "Org Demo A", project: "Project X",
      country: "DRC", village: "Kiasi", activity: "Agroforestry",
      applications: 1, parcelAreaHa: 3.4, contractedAreaHa: 3.0,
      beneficiaryType: "Individual farmer",
      startDate: "2024-07-01", endDate: "2029-07-01",
      series: [
        { year: 2019, tcHa: 2.6, lossHa: null },
        { year: 2020, tcHa: 2.5, lossHa: 0.1 },
        { year: 2021, tcHa: 2.45, lossHa: 0.05 },
        { year: 2022, tcHa: 2.4, lossHa: 0.05 },
        { year: 2023, tcHa: 2.2, lossHa: 0.2 },
        { year: 2024, tcHa: 2.0, lossHa: 0.2 },
        { year: 2025, tcHa: 2.1, lossHa: 0.0 },
      ],
      activityGroup: "agroforestry",
      overallStatus: "watch",
      scorecard: [
        { key: "open_incidents", value: 0, unit: null, status: "ok", target: null },
        { key: "achieved_pct", value: 70.0, unit: "%", status: "ok", target: 70 },
        { key: "tc_trend", value: 0.1, unit: "ha", status: "ok", target: null },
        { key: "no_clearing", value: 0.05, unit: "ha", status: "watch", target: null },
      ],
    } as T;
  }
  // Photos need live storage: harmless empty answers in demo mode.
  if (path === "/photos.geojson") {
    return { type: "FeatureCollection", features: [] } as T;
  }
  if (/^\/applications\/[^/]+\/photos$/.test(path)) return [] as T;
  const pm = path.match(/^\/applications\/([^/]+)\/profile$/);
  if (pm) {
    const id = decodeURIComponent(pm[1]);
    return {
      applicationId: id,
      applicationCode: id,
      applicationDate: "2024-06-01",
      activity: "Agroforestry",
      activityGroup: "agroforestry",
      stage: { name: "Validated", order: 5, total: 7, category: "active", status: "In progress" },
      location: { country: "DRC", province: "Kongo-Central", territory: "Songololo", village: "Kiasi" },
      beneficiary: {
        type: "Individual farmer", status: "Active", gender: "Female",
        familySituation: "Married", dependents: 4, communityMembers: 12,
      },
      project: { name: "Project X", org: "Org Demo A", orgAcronym: "ODA", aggregator: "Green Coop (GC)" },
      contract: {
        code: "CTR-DEMO", status: "Active", start: "2024-07-01", end: "2029-07-01",
        durationYears: 5, declaredAreaHa: 3.2, contractedAreaHa: 3.0,
        pctElapsed: 44.9, daysRemaining: 1004,
        species: [
          { name: "Acacia", densityPerHa: 400 },
          { name: "Moringa", densityPerHa: 150 },
        ],
      },
      visits: { expected: 6, completed: 2, lastDate: "2025-03-15", nextDue: "2025-09-15", overdue: false },
      fire: { burned5yrHa: 0, burnedPct: 0, fireAlerts5yr: 0, category: "low" },
      performance: {
        achievedHa: 2.1, gapHa: 0.9, achievedPct: 70,
        monitoredTotalHa: 3.0, observedTrees: 820,
        observedLandCover: "Cropland", observedLandCoverPct: 61.5,
      },
      areas: { estimatedHa: 3.5, declaredHa: 3.2, contractedHa: 3.0, achievedHa: 2.1 },
      baseline: {
        parcelAreaHa: 3.4, treeCoverHa: 2.1, defor5yrHaYr: 0.05, baselineYears: 5,
        landcoverAtApp: "Cropland", landcoverAtAppPct: 61.5,
        landcoverCurrent: "Trees", landcoverCurrentPct: 48.0, landcoverChanged: true,
        series: [
          { year: 2019, tcHa: 2.6, lossHa: null },
          { year: 2020, tcHa: 2.5, lossHa: 0.1 },
          { year: 2021, tcHa: 2.45, lossHa: 0.05 },
          { year: 2022, tcHa: 2.4, lossHa: 0.05 },
          { year: 2023, tcHa: 2.2, lossHa: 0.2 },
          { year: 2024, tcHa: 2.0, lossHa: 0.2 },
          { year: 2025, tcHa: 2.1, lossHa: 0.0 },
        ],
      },
      geometrySource: "polygon",
      lastSync: "2026-10-01T12:30:00Z",
    } as T;
  }
  if (path === "/incidents") {
    const items = [
      { incidentUid: "DEMO-A2:fire:2026-09-20", applicationId: "DEMO-A2",
        kind: "fire", firstDetected: "2026-09-20", lastDetected: "2026-10-01",
        magnitude: 4, status: "open", statusNote: null, statusBy: null,
        statusUtc: null, updatedUtc: "2026-10-02T06:00:00Z",
        applicationCode: "DEMO-CA1002-BE0002", implementingOrg: "Org Demo A",
        projectName: "Project X", country: "DRC", province: "Mai-Ndombe",
        pesActivity: "Reforestation" },
      { incidentUid: "DEMO-A1:deforestation:2026-09-05", applicationId: "DEMO-A1",
        kind: "deforestation", firstDetected: "2026-09-05", lastDetected: "2026-09-18",
        magnitude: 37, status: "responded", statusNote: "field visit planned",
        statusBy: "demo.monitor", statusUtc: "2026-09-19T09:00:00Z",
        updatedUtc: "2026-09-19T09:00:00Z",
        applicationCode: "DEMO-CA1001-BE0001", implementingOrg: "Org Demo A",
        projectName: "Project X", country: "DRC", province: "Kongo-Central",
        pesActivity: "Agroforestry" },
    ];
    const f = (params ?? {}) as { status?: string; kind?: string };
    const shown = items.filter(
      (i) => (!f.status || i.status === f.status) && (!f.kind || i.kind === f.kind),
    );
    return {
      summary: { open: 1, responded: 1, verified: 0, dismissed: 0, resolved: 0 },
      items: shown,
    } as T;
  }
  if (path === "/admin/exceptions") {
    return {
      summary: [
        { reason: "oversize_gt_5000ha", objects: 1 },
        { reason: "no_usable_geometry", objects: 1 },
        { reason: "landcover_failed", objects: 1 },
      ],
      items: [
        { objectId: "DEMO-A9", objectType: "application", reason: "oversize_gt_5000ha",
          areaGis: 6200, occurrences: 4, lastSeen: "2026-10-03T06:00:00Z",
          applicationCode: "DEMO-CA1009-BE0009", implementingOrg: "Org Demo B", country: "DRC" },
        { objectId: "DEMO-A10", objectType: "application", reason: "no_usable_geometry",
          areaGis: null, occurrences: 4, lastSeen: "2026-10-03T06:00:00Z",
          applicationCode: "DEMO-CA1010-BE0010", implementingOrg: "Org Demo C", country: "DRC" },
        { objectId: "DEMO-A1", objectType: "application", reason: "landcover_failed",
          areaGis: null, occurrences: 1, lastSeen: "2026-10-02T20:00:00Z",
          applicationCode: "DEMO-CA1001-BE0001", implementingOrg: "Org Demo A", country: "DRC" },
      ],
    } as T;
  }
  if (path === "/applications.geojson") return load("applications.geojson.json");
  // Contracts derive from visits in production; the demo derives them from
  // the application snapshot (one contract per app carrying a contract code).
  if (path === "/contracts.geojson") {
    const apps = await load<GeoJSON.FeatureCollection>("applications.geojson.json");
    const features = apps.features
      .filter((f) => (f.properties ?? {}).contractCode)
      .map((f) => ({
        type: "Feature" as const,
        geometry: f.geometry,
        properties: {
          contractCode: f.properties!.contractCode,
          applicationId: f.properties!.applicationId,
          applicationCode: f.properties!.applicationCode,
          pesActivity: f.properties!.pesActivity,
          contractStatus: "Active",
          visitCount: 2,
          visitsWithGeometry: 0,
          selectedVisitRule: "latest_completed_visit",
          geometrySource: "application_shape_fallback",
        },
      }));
    return { type: "FeatureCollection", features } as T;
  }
  if (path === "/governance/layers") return load("governance/layers.json");
  let m = path.match(/^\/applications\/([^/]+)\/indicators$/);
  if (m) return load(`indicators/${decodeURIComponent(m[1])}.json`);
  m = path.match(/^\/governance\/([a-z_]+)\.geojson$/);
  if (m) return load(`governance/${m[1]}.geojson.json`);
  m = path.match(/^\/governance\/features\/(.+)\/documents$/);
  if (m) {
    const bundle = await load<Record<string, GovDocument[]>>("governance/documents.json");
    return (bundle[decodeURIComponent(m[1])] ?? []) as T;
  }
  throw new Error(`no demo snapshot for ${path}`);
}
