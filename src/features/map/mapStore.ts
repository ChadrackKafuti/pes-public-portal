/** Runtime map objects (non-serialisable) shared by every feature: element, view, layers, selection graphic. */
import { create } from "zustand";
import type MapView from "@arcgis/core/views/MapView";
import type WebMap from "@arcgis/core/WebMap";
import type Graphic from "@arcgis/core/Graphic";
import type GroupLayer from "@arcgis/core/layers/GroupLayer";
import type Basemap from "@arcgis/core/Basemap";
import type { PesLayers } from "@/services/layers";

export type MapStatus = "idle" | "loading" | "ready" | "error";

interface MapState {
  el: HTMLArcgisMapElement | null;
  view: MapView | null;
  map: WebMap | null;
  status: MapStatus;
  error: string | null;
  pes: PesLayers | null;
  forestGroup: GroupLayer | null;
  originalBasemap: Basemap | null;
  selectedGraphic: Graphic | null;
  highlight: { remove(): void } | null;
  set(patch: Partial<Omit<MapState, "set" | "selectGraphic" | "clearSelection">>): void;
  selectGraphic(graphic: Graphic | null, highlight: { remove(): void } | null): void;
  clearSelection(): void;
}

export const useMapStore = create<MapState>()((set, get) => ({
  el: null,
  view: null,
  map: null,
  status: "idle",
  error: null,
  pes: null,
  forestGroup: null,
  originalBasemap: null,
  selectedGraphic: null,
  highlight: null,
  set: (patch) => set(patch),
  selectGraphic: (graphic, highlight) => {
    get().highlight?.remove();
    set({ selectedGraphic: graphic, highlight });
  },
  clearSelection: () => {
    get().highlight?.remove();
    set({ selectedGraphic: null, highlight: null });
  },
}));
