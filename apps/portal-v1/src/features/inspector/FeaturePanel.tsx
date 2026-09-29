import "@arcgis/map-components/components/arcgis-feature";
import { useEffect, useRef } from "react";
import { ArrowLeft } from "lucide-react";
import { useT } from "@/i18n";
import { Button } from "@/components/ui";
import { useAppStore } from "@/core/store";
import { useMapStore } from "@/features/map/mapStore";
import s from "./FeaturePanel.module.css";

/** Shows the selected feature with the web map's own popup (Arcade needs map + view context). */
export function FeaturePanel() {
  const t = useT();
  const ref = useRef<HTMLArcgisFeatureElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const graphic = useMapStore((m) => m.selectedGraphic);
  const map = useMapStore((m) => m.map);
  const view = useMapStore((m) => m.view);
  const select = useAppStore((st) => st.select);
  const clear = useMapStore((m) => m.clearSelection);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (map) el.map = map;
    if (view) el.view = view;
    el.graphic = graphic;
  }, [graphic, map, view]);

  useEffect(() => {
    if (graphic) headingRef.current?.focus();
  }, [graphic]);

  if (!graphic) return null;
  const back = () => {
    clear();
    select(null);
  };
  return (
    <div className={s.panel}>
      <div className={s.bar}>
        <Button variant="ghost" tone="dark" size="sm" icon={<ArrowLeft size={14} aria-hidden="true" />} onClick={back}>
          {t("info.back")}
        </Button>
      </div>
      <h2 ref={headingRef} tabIndex={-1} className="visually-hidden">
        {(graphic.layer as { title?: string } | null)?.title ?? t("panel.overview")}
      </h2>
      <arcgis-feature ref={ref} className="calcite-mode-dark" />
    </div>
  );
}
