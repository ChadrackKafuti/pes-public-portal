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
  if (path === "/health/runs") return load("runs.json");
  if (path === "/applications.geojson") return load("applications.geojson.json");
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
