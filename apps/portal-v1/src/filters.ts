/** Filter state and SQL where-clause generation for the PES feature layers. */
import type FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import { CONFIG } from "./config";

export interface FilterState {
  /** filter id -> selected values (empty = all) */
  values: Record<string, string[]>;
  /** free-text code search */
  code: string;
  /** ISO dates yyyy-mm-dd */
  from: string;
  to: string;
}

export function emptyState(): FilterState {
  return { values: {}, code: "", from: "", to: "" };
}

export function isEmpty(state: FilterState): boolean {
  return (
    !state.code &&
    !state.from &&
    !state.to &&
    Object.values(state.values).every((v) => v.length === 0)
  );
}

/** Real field name on the layer for the first candidate that exists (case-insensitive). */
export function findField(layer: FeatureLayer, candidates: string[]): string | null {
  const names = new Map((layer.fields ?? []).map((f) => [f.name.toLowerCase(), f.name]));
  for (const c of candidates) {
    const real = names.get(c.toLowerCase());
    if (real) return real;
  }
  return null;
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** Build the where clause for one layer; fields absent from the layer are ignored. */
export function buildWhere(layer: FeatureLayer, state: FilterState): string {
  const parts: string[] = [];
  for (const def of CONFIG.filters) {
    const selected = state.values[def.id] ?? [];
    if (selected.length === 0) continue;
    const field = findField(layer, def.fields);
    if (!field) continue;
    parts.push(`${field} IN (${selected.map(sqlString).join(",")})`);
  }
  const code = state.code.trim();
  if (code) {
    const fields = CONFIG.codeFields.map((c) => findField(layer, [c])).filter((f): f is string => !!f);
    if (fields.length) {
      const like = sqlString(`%${code.toUpperCase()}%`);
      parts.push(`(${fields.map((f) => `UPPER(${f}) LIKE ${like}`).join(" OR ")})`);
    }
  }
  if (state.from || state.to) {
    const field = findField(layer, CONFIG.dateFields);
    if (field) {
      if (state.from) parts.push(`${field} >= TIMESTAMP '${state.from} 00:00:00'`);
      if (state.to) parts.push(`${field} <= TIMESTAMP '${state.to} 23:59:59'`);
    }
  }
  return parts.length ? parts.join(" AND ") : "1=1";
}

/** Distinct non-empty values of a field, optionally restricted by a where clause. */
export async function uniqueValues(layer: FeatureLayer, field: string, where = "1=1"): Promise<string[]> {
  const result = await layer.queryFeatures({
    where: `${where} AND ${field} IS NOT NULL AND ${field} <> ''`,
    outFields: [field],
    returnDistinctValues: true,
    returnGeometry: false,
    orderByFields: [field],
    num: 2000,
  });
  const values = result.features.map((f) => String(f.attributes[field] ?? "").trim()).filter((v) => v.length > 0);
  return [...new Set(values)];
}
