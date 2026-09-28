import type { ApplicationList, PesRsObject, RunHealth } from "@cafi/shared";

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const qs = params
    ? "?" + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "")).toString()
    : "";
  const r = await fetch(`/api${path}${qs}`);
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return r.json() as Promise<T>;
}

export const api = {
  applications: (params: { activity?: string; status?: string; q?: string } = {}) =>
    get<ApplicationList>("/applications", params as Record<string, string>),
  applicationIndicators: (id: string) =>
    get<PesRsObject[]>(`/applications/${encodeURIComponent(id)}/indicators`),
  contractIndicators: (code: string) =>
    get<PesRsObject[]>(`/contracts/${encodeURIComponent(code)}/indicators`),
  runs: () => get<RunHealth[]>("/health/runs"),
};
