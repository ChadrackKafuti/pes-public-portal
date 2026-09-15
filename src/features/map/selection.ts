/** Select a graphic on the shared view: re-query the full feature, highlight it, publish it to both stores. */
import type Graphic from "@arcgis/core/Graphic";
import type Layer from "@arcgis/core/layers/Layer";
import { fullFeature } from "@/services/layers";
import { useAppStore } from "@/core/store";
import { useMapStore } from "./mapStore";

export async function selectGraphicOnMap(graphic: Graphic): Promise<void> {
  const { view } = useMapStore.getState();
  if (!view) return;
  const full = (await fullFeature(view, graphic)) ?? graphic;
  const layer = full.layer as Layer | null;
  let handle: { remove(): void } | null = null;
  if (layer) {
    try {
      const lv = await view.whenLayerView(layer);
      if ("highlight" in lv) handle = (lv as unknown as { highlight(g: Graphic): { remove(): void } }).highlight(full);
    } catch {
      /* no layer view */
    }
  }
  useMapStore.getState().selectGraphic(full, handle);
  const oidField = (layer as { objectIdField?: string } | null)?.objectIdField ?? "objectid";
  useAppStore.getState().select({
    layerTitle: layer?.title ?? "",
    layerUrl: (layer as { url?: string } | null)?.url ?? "",
    oid: Number(full.attributes?.[oidField] ?? -1),
  });
}

