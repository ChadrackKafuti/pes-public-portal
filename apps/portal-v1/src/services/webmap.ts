/** Builds the WebMap from the JSON snapshot produced by scripts/fetch-webmap.mjs (the portal blocks CORS). */
import WebMap from "@arcgis/core/WebMap";
import Extent from "@arcgis/core/geometry/Extent";
import Viewpoint from "@arcgis/core/Viewpoint";
import { CONFIG } from "@/config";

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

export function basinExtent(): Extent {
  const e = CONFIG.initialExtent ?? { xmin: 5, ymin: -14, xmax: 32, ymax: 12 };
  return new Extent({ ...e, spatialReference: { wkid: 4326 } });
}

/** Every caller gets its own loaded WebMap instance (a map cannot be shared by two views). */
export async function loadWebMap(itemId: string): Promise<WebMap> {
  const json = await loadJson(itemId);
  const webmap = WebMap.fromJSON(json);
  if (CONFIG.initialExtent) {
    webmap.initialViewProperties.viewpoint = new Viewpoint({ targetGeometry: basinExtent() });
  }
  await webmap.load();
  return webmap;
}
