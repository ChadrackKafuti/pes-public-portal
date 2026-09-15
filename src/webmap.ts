/** Builds WebMap instances from the JSON snapshots produced by scripts/fetch-webmap.mjs. */
import WebMap from "@arcgis/core/WebMap";
import Extent from "@arcgis/core/geometry/Extent";
import Viewpoint from "@arcgis/core/Viewpoint";
import { CONFIG } from "./config";

const cache = new Map<string, Promise<unknown>>();

async function loadJson(itemId: string): Promise<unknown> {
  let pending = cache.get(itemId);
  if (!pending) {
    pending = (async () => {
      const url = `${import.meta.env.BASE_URL}webmaps/${itemId}.json`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Web map snapshot not found: ${url} (run "npm run fetch:webmaps")`);
      return res.json();
    })();
    cache.set(itemId, pending);
  }
  return pending;
}

/** Every caller gets its own WebMap instance: a map cannot be shared by two views. */
export async function loadWebMap(itemId: string): Promise<WebMap> {
  const json = await loadJson(itemId);
  const webmap = WebMap.fromJSON(json);
  const e = CONFIG.initialExtent;
  if (e) {
    // initial view and "home" target: the whole Congo Basin instead of the web map's saved extent
    webmap.initialViewProperties.viewpoint = new Viewpoint({
      targetGeometry: new Extent({ ...e, spatialReference: { wkid: 4326 } }),
    });
  }
  return webmap;
}
