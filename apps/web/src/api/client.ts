import type { ApplicationList, FilterOptions, PesRsObject, RunHealth } from "@cafi/shared";
import { authEnabled, authHeaders, useAuth } from "../auth";

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
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
};
