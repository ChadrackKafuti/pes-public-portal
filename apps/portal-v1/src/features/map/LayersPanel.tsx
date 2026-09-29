import "@arcgis/map-components/components/arcgis-layer-list";
import "@arcgis/map-components/components/arcgis-legend";
import { useEffect, useRef } from "react";
import type Layer from "@arcgis/core/layers/Layer";
import { useLang, useT } from "@/i18n";
import { FOREST_GROUP_LABEL } from "@/i18n/forestLabels";
import { forestDisplayName } from "@/services/forestLayers";
import { CollapsibleSection } from "@/components/ui";
import { useMapStore } from "./mapStore";
import { BasemapSwitch } from "./BasemapSwitch";
import s from "./LayersPanel.module.css";

interface ListItemLike {
  layer?: unknown;
  title: string;
  children?: { toArray(): ListItemLike[] };
}

export function LayersPanel() {
  const t = useT();
  const lang = useLang();
  const el = useMapStore((m) => m.el);
  const ready = useMapStore((m) => m.status === "ready");
  const listRef = useRef<HTMLArcgisLayerListElement>(null);
  const legendRef = useRef<HTMLArcgisLegendElement>(null);

  // bind both components to the shared map element
  useEffect(() => {
    if (!el) return;
    if (listRef.current) listRef.current.referenceElement = el;
    if (legendRef.current) legendRef.current.referenceElement = el;
  }, [el, ready]);

  // translated display names for the forest layers (titles stay fixed for the Arcade popups)
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const label = (raw: unknown) => {
      const layer = raw as Layer | null | undefined;
      if (!layer) return null;
      return layer.id === "forest-governance" ? FOREST_GROUP_LABEL[lang] : forestDisplayName(layer, lang);
    };
    list.listItemCreatedFunction = (event) => {
      const name = label(event.item.layer);
      if (name) event.item.title = name;
    };
    const relabel = (items: ListItemLike[]) => {
      for (const item of items) {
        const name = label(item.layer);
        if (name) item.title = name;
        if (item.children) relabel(item.children.toArray());
      }
    };
    const items = (list as unknown as { operationalItems?: { toArray(): ListItemLike[] } }).operationalItems;
    if (items) relabel(items.toArray());
  }, [lang, ready]);

  return (
    <div className={`${s.panel} calcite-mode-dark`}>
      <arcgis-layer-list ref={listRef} showCollapseButton visibilityAppearance="checkbox" />
      <CollapsibleSection title={t("panel.legend")} defaultOpen={false}>
        <arcgis-legend ref={legendRef} hideLayersNotInCurrentView respectLayerDefinitionExpression />
      </CollapsibleSection>
      <CollapsibleSection title={t("panel.basemap")} defaultOpen={false}>
        <BasemapSwitch />
      </CollapsibleSection>
    </div>
  );
}
