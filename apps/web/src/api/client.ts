import type {
  AdminExceptions,
  AlertRow,
  AnalysesContract,
  ContractAnalysis,
  AoiResult,
  ApplicationList,
  Dashboard,
  FilterOptions,
  GovDocument,
  GovLayerInfo,
  GovLayerKey,
  IncidentItem,
  Incidents,
  PesRsObject,
  Photo,
  Profile,
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

async function patch<T>(path: string, body: unknown): Promise<T> {
  if (demoEnabled) throw new Error("not available in demo mode");
  const r = await fetch(`/api${path}`, {
    method: "PATCH",
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
  contractsGeojson: () => get<GeoJSON.FeatureCollection>("/contracts.geojson"),
  governanceLayers: () => get<GovLayerInfo[]>("/governance/layers"),
  governanceGeojson: (layer: GovLayerKey) =>
    get<GeoJSON.FeatureCollection>(`/governance/${layer}.geojson`),
  governanceFeature: (srcUid: string) =>
    get<Record<string, unknown>>(`/governance/features/${encodeURIComponent(srcUid)}`),
  governanceDocuments: (srcUid: string) =>
    get<GovDocument[]>(`/governance/features/${encodeURIComponent(srcUid)}/documents`),
  aoi: (geometry: GeoJSON.Polygon) => post<AoiResult>("/aoi", { geometry }),
  analysesContracts: () => get<AnalysesContract[]>("/analyses/contracts"),
  contractAnalysis: (code: string) =>
    get<ContractAnalysis>(`/analyses/contracts/${encodeURIComponent(code)}`),
  photosGeojson: (application?: string) =>
    get<GeoJSON.FeatureCollection>("/photos.geojson", application ? { application } : undefined),
  applicationProfile: (id: string) =>
    get<Profile>(`/applications/${encodeURIComponent(id)}/profile`),
  applicationPhotos: (id: string) =>
    get<Photo[]>(`/applications/${encodeURIComponent(id)}/photos`),
  photoImageUrl: (uid: string) =>
    get<{ url: string }>(`/photos/${encodeURIComponent(uid)}/image-url`),
  adminExceptions: () => get<AdminExceptions>("/admin/exceptions"),
  incidents: (params: { status?: string; kind?: string; country?: string } = {}) =>
    get<Incidents>("/incidents", params as Record<string, string>),
  incidentUpdate: (uid: string, status: string, note?: string) =>
    patch<IncidentItem>(`/incidents/${encodeURIComponent(uid)}`, { status, note }),
};
