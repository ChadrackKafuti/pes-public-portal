/** Application state (Zustand). Serialisable slices only; ArcGIS objects live in MapProvider/context. */
import { create } from "zustand";
import type { FilterState } from "@/filters";
import { emptyState } from "@/filters";

export type PanelTab = "overview" | "filters" | "layers";
export type SheetSnap = "peek" | "half" | "full";

export interface Selection {
  /** Layer title + object id identify the feature; the graphic itself is held by the inspector feature. */
  layerTitle: string;
  layerUrl: string;
  oid: number;
  label?: string;
}

export interface Aoi {
  source: "draw" | "kml";
  name: string;
  /** WGS84 polygon rings */
  rings: number[][][];
  areaHa: number;
}

export type KpiStatus = "idle" | "loading" | "ready" | "error";
export interface KpiBreakdown {
  value: string;
  count: number;
}
export interface KpiData {
  applications: number | null;
  contracts: number | null;
  countries: number | null;
  contractedHa: number | null;
  plantedHa: number | null;
  trees: number | null;
  visitsDone: number | null;
  visitsExpected: number | null;
  visitsRecorded: number | null;
  byActivity: KpiBreakdown[];
  byGender: KpiBreakdown[];
  byStage: KpiBreakdown[];
}

export interface AppState {
  // filters
  draft: FilterState;
  applied: FilterState;
  setDraft(patch: Partial<FilterState>): void;
  setDraftValue(id: string, values: string[]): void;
  applyFilters(): void;
  resetFilters(): void;
  // ui
  tab: PanelTab;
  setTab(tab: PanelTab): void;
  panelOpen: boolean;
  setPanelOpen(open: boolean): void;
  sheetSnap: SheetSnap;
  setSheetSnap(snap: SheetSnap): void;
  // selection
  selection: Selection | null;
  select(sel: Selection | null): void;
  // aoi
  aoi: Aoi | null;
  setAoi(aoi: Aoi | null): void;
  drawing: boolean;
  setDrawing(on: boolean): void;
  // kpi
  kpi: { status: KpiStatus; data: KpiData | null; error: string | null; key: string };
  setKpi(patch: Partial<AppState["kpi"]>): void;
  // analyses
  contractCode: string | null;
  setContractCode(code: string | null): void;
}

export const useAppStore = create<AppState>()((set) => ({
  draft: emptyState(),
  applied: emptyState(),
  setDraft: (patch) => set((s) => ({ draft: { ...s.draft, ...patch } })),
  setDraftValue: (id, values) => set((s) => ({ draft: { ...s.draft, values: { ...s.draft.values, [id]: values } } })),
  applyFilters: () => set((s) => ({ applied: structuredClone(s.draft) })),
  resetFilters: () => set({ draft: emptyState(), applied: emptyState() }),

  tab: "overview",
  setTab: (tab) => set({ tab, panelOpen: true }),
  panelOpen: true,
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  sheetSnap: "peek",
  setSheetSnap: (sheetSnap) => set({ sheetSnap }),

  selection: null,
  select: (selection) => set({ selection, tab: "overview", panelOpen: true }),

  aoi: null,
  setAoi: (aoi) => set({ aoi }),
  drawing: false,
  setDrawing: (drawing) => set({ drawing }),

  kpi: { status: "idle", data: null, error: null, key: "" },
  setKpi: (patch) => set((s) => ({ kpi: { ...s.kpi, ...patch } })),

  contractCode: null,
  setContractCode: (contractCode) => set({ contractCode }),
}));

/** Number of non-empty filter dimensions in a filter state. */
export function activeFilterCount(state: FilterState): number {
  let n = Object.values(state.values).filter((v) => v.length > 0).length;
  if (state.code.trim()) n += 1;
  if (state.from || state.to) n += 1;
  return n;
}
