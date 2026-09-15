/** Feature-service queries with cancellation and a short-lived memo cache. */
import type FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import type Query from "@arcgis/core/rest/support/Query";
import type FeatureSet from "@arcgis/core/rest/support/FeatureSet";

type Params = Partial<Query> | Record<string, unknown>;

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; value: Promise<unknown> }>();

function key(layer: FeatureLayer, kind: string, params: Params): string {
  return `${layer.url}|${kind}|${JSON.stringify(params, (_k, v) => (typeof v === "object" && v && "toJSON" in v ? (v as { toJSON(): unknown }).toJSON() : v))}`;
}

function remember<T>(k: string, run: () => Promise<T>): Promise<T> {
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as Promise<T>;
  const value = run().catch((err) => {
    cache.delete(k);
    throw err;
  });
  cache.set(k, { at: Date.now(), value });
  return value;
}

export function clearQueryCache(): void {
  cache.clear();
}

export function queryFeatures(layer: FeatureLayer, params: Params, signal?: AbortSignal): Promise<FeatureSet> {
  return remember(key(layer, "features", params), () => layer.queryFeatures(params as Partial<Query>, { signal }));
}

export function queryCount(layer: FeatureLayer, params: Params, signal?: AbortSignal): Promise<number> {
  return remember(key(layer, "count", params), () => layer.queryFeatureCount(params as Partial<Query>, { signal }));
}

/** Escape a string literal for a where clause. */
export function sql(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function isAbort(err: unknown): boolean {
  return (err as { name?: string })?.name === "AbortError";
}

/** Keeps one in-flight controller per scope; starting a new run aborts the previous one. */
export class Runner {
  private controller: AbortController | null = null;
  start(): AbortSignal {
    this.controller?.abort();
    this.controller = new AbortController();
    return this.controller.signal;
  }
  cancel(): void {
    this.controller?.abort();
    this.controller = null;
  }
}
