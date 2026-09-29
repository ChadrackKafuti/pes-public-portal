import { useState } from "react";
import { useT } from "@/i18n";
import { CONFIG } from "@/config";
import { useMapStore } from "./mapStore";
import s from "./BasemapSwitch.module.css";

export function BasemapSwitch() {
  const t = useT();
  const [current, setCurrent] = useState("webmap");
  const choices = [{ id: "webmap", labelKey: "basemap.webmap" as const }, ...CONFIG.basemaps.map((b) => ({ id: b.id, labelKey: b.labelKey as "basemap.topo" }))];

  const choose = async (id: string) => {
    setCurrent(id);
    const { map, originalBasemap } = useMapStore.getState();
    if (!map) return;
    if (id === "webmap") {
      if (originalBasemap) map.basemap = originalBasemap;
      return;
    }
    const def = CONFIG.basemaps.find((b) => b.id === id);
    if (!def) return;
    const [{ default: Basemap }, { default: TileLayer }, { default: OpenStreetMapLayer }] = await Promise.all([
      import("@arcgis/core/Basemap"),
      import("@arcgis/core/layers/TileLayer"),
      import("@arcgis/core/layers/OpenStreetMapLayer"),
    ]);
    const layer = def.url === "osm" ? new OpenStreetMapLayer() : new TileLayer({ url: def.url });
    map.basemap = new Basemap({ baseLayers: [layer], title: t(def.labelKey as "basemap.topo"), id: def.id });
  };

  return (
    <div className={s.group} role="radiogroup" aria-label={t("panel.basemap")}>
      {choices.map((c) => (
        <button key={c.id} type="button" role="radio" aria-checked={current === c.id} className={s.item} onClick={() => void choose(c.id)}>
          {t(c.labelKey)}
        </button>
      ))}
    </div>
  );
}
