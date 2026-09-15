/** Contract analysis data: contract list, annual tree-cover rows, contract geometry. */
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import type Graphic from "@arcgis/core/Graphic";
import type MapView from "@arcgis/core/views/MapView";
import { CONFIG } from "@/config";
import { queryFeatures, sql } from "./query";

export interface ContractRow {
  code: string;
  organisation: string;
  acronym: string;
  project: string;
  village: string;
  country: string;
  province: string;
  beneficiaryType: string;
  activity: string;
  contractedArea: number | null;
  start: number | null;
  end: number | null;
}

export interface YearRow {
  year: number;
  treeCover: number | null;
  loss: number | null;
  parcelArea: number | null;
}

let contractsLayer: FeatureLayer | null = null;
let analysisTable: FeatureLayer | null = null;

/** The contracts layer of the web map when available (shares its cache), else a standalone one. */
export function getContractsLayer(fromMap?: FeatureLayer | null): FeatureLayer {
  if (fromMap) return fromMap;
  contractsLayer ??= new FeatureLayer({ url: CONFIG.contractsLayerUrl, outFields: ["*"] });
  return contractsLayer;
}

function getAnalysisTable(): FeatureLayer {
  analysisTable ??= new FeatureLayer({ url: CONFIG.analysisTableUrl, outFields: ["*"] });
  return analysisTable;
}

export function numberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function uniq(values: string[]): string[] {
  return [...new Set(values.filter((v) => v.trim().length > 0))].sort((a, b) => a.localeCompare(b));
}

export async function loadContracts(layer: FeatureLayer, signal?: AbortSignal): Promise<ContractRow[]> {
  const f = CONFIG.contractFields;
  const result = await queryFeatures(
    layer,
    { where: "1=1", outFields: Object.values(f), returnGeometry: false, orderByFields: [f.code], num: 5000 },
    signal,
  );
  return result.features
    .map((g) => g.attributes as Record<string, unknown>)
    .filter((a) => a[f.code])
    .map((a) => ({
      code: String(a[f.code]),
      organisation: String(a[f.organisation] ?? ""),
      acronym: String(a[f.acronym] ?? ""),
      project: String(a[f.project] ?? ""),
      village: String(a[f.village] ?? ""),
      country: String(a[f.country] ?? ""),
      province: String(a[f.province] ?? ""),
      beneficiaryType: String(a[f.beneficiaryType] ?? ""),
      activity: String(a[f.activity] ?? ""),
      contractedArea: numberOrNull(a[f.contractedArea]),
      start: numberOrNull(a[f.start]),
      end: numberOrNull(a[f.end]),
    }));
}

export async function loadAnalysis(code: string, signal?: AbortSignal): Promise<YearRow[]> {
  const f = CONFIG.analysisFields;
  const result = await queryFeatures(
    getAnalysisTable(),
    {
      where: `${f.contract} = ${sql(code)}`,
      outFields: [f.year, f.treeCover, f.treeCoverLoss, f.parcelArea],
      returnGeometry: false,
      orderByFields: [f.year],
      num: 200,
    },
    signal,
  );
  return result.features
    .map((g) => g.attributes as Record<string, unknown>)
    .filter((a) => a[f.year] !== null && a[f.year] !== undefined)
    .map((a) => ({
      year: Number(a[f.year]),
      treeCover: numberOrNull(a[f.treeCover]),
      loss: numberOrNull(a[f.treeCoverLoss]),
      parcelArea: numberOrNull(a[f.parcelArea]),
    }));
}

export async function fetchContractGraphic(layer: FeatureLayer, code: string, view: MapView, signal?: AbortSignal): Promise<Graphic | null> {
  const f = CONFIG.contractFields;
  const result = await queryFeatures(
    layer,
    { where: `${f.code} = ${sql(code)}`, outFields: [f.code], returnGeometry: true, outSpatialReference: view.spatialReference },
    signal,
  );
  return result.features[0] ?? null;
}

/** Latest year, tree-cover share of the parcel (or contracted) area. */
export function summarise(rows: YearRow[], contract: ContractRow): { latest: YearRow; share: number | null } | null {
  const latest = rows[rows.length - 1];
  if (!latest) return null;
  const area = latest.parcelArea ?? contract.contractedArea;
  const share = latest.treeCover !== null && area ? (latest.treeCover / area) * 100 : null;
  return { latest, share };
}
