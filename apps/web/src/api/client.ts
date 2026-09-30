import type {
  AlertRow,
  AoiResult,
  ApplicationList,
  Dashboard,
  FilterOptions,
  GovDocument,
  GovLayerInfo,
  GovLayerKey,
  PesRsObject,
  RunHealth,
} from "@cafi/shared";
import { authEnabled, authHeaders, useAuth } from "../auth";
import { demoEnabled, demoGet } from "./demo";

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  if (demoEnabled) return demoGet<T>(path, params);
  const qs = params
    ? "?" + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "")).toString()
    : "";
  const r = await fetch(`/api${path}${qs}`, { headers: authHeaders() });
  if (r.status === 401 && authEnabled) {
    useAuth.getState().login(); // session expired: back through Keycloak
  }
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return r.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  if (demoEnabled) throw new Error("not available in demo mode");
  const r = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (r.status === 401 && authEnabled) {
    useAuth.getState().login();
  }
  if (!r.ok) {
    let detail = "";
    try {
      detail = ((await r.json()) as { detail?: string }).detail ?? "";
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail || `${r.status} ${path}`);
  }
  return r.json() as Promise<T>;
}

export interface ApplicationFilters {
  activity?: string;
  country?: string;
  province?: string;
  org?: string;
  project?: string;
  status?: string;
  q?: string;
}

export const api = {
  applications: (params: ApplicationFilters = {}) =>
    get<ApplicationList>("/applications", params as Record<string, string>),
  filters: (country?: string) =>
    get<FilterOptions>("/filters", country ? { country } : undefined),
  applicationIndicators: (id: string) =>
    get<PesRsObject[]>(`/applications/${encodeURIComponent(id)}/indicators`),
  contractIndicators: (code: string) =>
    get<PesRsObject[]>(`/contracts/${encodeURIComponent(code)}/indicators`),
  runs: () => get<RunHealth[]>("/health/runs"),
  alerts: (country?: string) =>
    get<AlertRow[]>("/alerts", country ? { country } : undefined),
  dashboard: (country?: string) =>
    get<Dashboard>("/dashboard", country ? { country } : undefined),
  applicationsGeojson: () => get<GeoJSON.FeatureCollection>("/applications.geojson"),
  governanceLayers: () => get<GovLayerInfo[]>("/governance/layers"),
  governanceGeojson: (layer: GovLayerKey) =>
    get<GeoJSON.FeatureCollection>(`/governance/${layer}.geojson`),
  governanceDocuments: (srcUid: string) =>
    get<GovDocument[]>(`/governance/features/${encodeURIComponent(srcUid)}/documents`),
  aoi: (geometry: GeoJSON.Polygon) => post<AoiResult>("/aoi", { geometry }),
};
