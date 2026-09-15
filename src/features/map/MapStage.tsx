/** The single shared <arcgis-map>: mounted once in the shell, bootstraps the web map, owns hit-testing. */
import "@arcgis/map-components/components/arcgis-map";
import "@arcgis/map-components/components/arcgis-zoom";
import "@arcgis/map-components/components/arcgis-home";
import "@arcgis/map-components/components/arcgis-scale-bar";
import { useEffect, useRef } from "react";
import type Graphic from "@arcgis/core/Graphic";
import { CONFIG } from "@/config";
import { getLang, useLang, useT } from "@/i18n";
import { loadWebMap } from "@/services/webmap";
import { installForestLayers, relabelForestGroup } from "@/services/forestLayers";
import { collectPesLayers, isPesLayer } from "@/services/layers";
import { selectGraphicOnMap } from "./selection";
import { Notice, Spinner } from "@/components/ui";
import { useMapStore } from "./mapStore";
import { CodeSearch } from "@/features/inspector/CodeSearch";
import s from "./MapStage.module.css";

async function bootstrap(el: HTMLArcgisMapElement): Promise<void> {
  const store = useMapStore.getState();
  if (store.status !== "idle") return;
  store.set({ el, status: "loading" });
  if (import.meta.env.DEV) (window as unknown as { __cafi: unknown }).__cafi = { el, store: useMapStore };
  try {
    const webmap = await loadWebMap(CONFIG.webmaps.map);
    const forestGroup = installForestLayers(webmap, getLang());
    useMapStore.getState().set({ map: webmap, forestGroup, originalBasemap: webmap.basemap ?? null });
    el.map = webmap;
  } catch (err) {
    console.error(err);
    useMapStore.getState().set({ status: "error", error: String((err as Error).message ?? err) });
  }
}

export default function MapStage() {
  const ref = useRef<HTMLArcgisMapElement>(null);
  const t = useT();
  const lang = useLang();
  const status = useMapStore((m) => m.status);
  const error = useMapStore((m) => m.error);

  // bootstrap once (StrictMode re-runs effects: the guard lives in the store, not in a cleanup flag)
  useEffect(() => {
    const el = ref.current;
    if (el) void bootstrap(el);
  }, []);

  // legend labels follow the language
  useEffect(() => {
    const g = useMapStore.getState().forestGroup;
    if (g) relabelForestGroup(g, lang);
  }, [lang]);

  const onReady = async () => {
    const el = ref.current;
    if (!el?.ready || !el.view || !el.map) return;
    const store = useMapStore.getState();
    store.set({ view: el.view });
    try {
      const pes = await collectPesLayers(el.map);
      store.set({ pes, status: "ready" });
    } catch (err) {
      console.error(err);
      store.set({ status: "error", error: String((err as Error).message ?? err) });
    }
  };

  const onClick = async (event: Event) => {
    const el = ref.current;
    const detail = (event as CustomEvent).detail as { x: number; y: number } | undefined;
    if (!el || !detail) return;
    try {
      const hit = await el.hitTest(detail);
      const graphics = hit.results
        .filter((r) => r.type === "graphic" && (r as { graphic?: Graphic }).graphic?.layer)
        .map((r) => (r as { graphic: Graphic }).graphic);
      if (graphics.length === 0) return;
      const target = graphics.find((g) => isPesLayer(g.layer)) ?? graphics[0];
      await selectGraphicOnMap(target);
    } catch {
      /* ignore hit-test failures */
    }
  };

  return (
    <div className={s.stage}>
      <arcgis-map ref={ref} popupDisabled onarcgisViewReadyChange={onReady} onarcgisViewClick={onClick} aria-label={t("nav.map")}>
        <arcgis-zoom slot="top-left" />
        <arcgis-home slot="top-left" />
        <div slot="top-right" className={s.searchSlot}>
          <CodeSearch />
        </div>
        <arcgis-scale-bar slot="bottom-left" unit="metric" />
      </arcgis-map>
      {status === "loading" && (
        <div className={s.loading} role="status">
          <Spinner label={t("map.loading")} /> <span>{t("map.loading")}</span>
        </div>
      )}
      {status === "error" && (
        <div className={s.error}>
          <Notice kind="danger" title={t("map.loadError")}>
            {error}
          </Notice>
        </div>
      )}
    </div>
  );
}
