/**
 * Snapshot the public web maps of the portal into public/webmaps/<itemId>.json.
 *
 * Why: the geosmart.undp.org portal does not send CORS headers, so a browser on another domain cannot read
 * portal items. The hosting server (geosmarthosting.undp.org) does allow cross-origin requests, so the app
 * builds the map from this JSON and the layers themselves load live from the hosting server.
 *
 * Runs automatically before `npm run build` (see package.json "prebuild") and in the GitHub Pages workflow,
 * so every deployment (including the daily scheduled one) picks up the latest web map definition.
 */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const config = JSON.parse(await readFile(path.join(root, "webmaps.config.json"), "utf8"));
const outDir = path.join(root, "public", "webmaps");
await mkdir(outDir, { recursive: true });

/** Remove portal item references (they would trigger blocked portal requests) and portal-proxied base layers. */
function sanitizeLayers(layers) {
  for (const layer of layers ?? []) {
    delete layer.itemId;
    if (layer.layers) sanitizeLayers(layer.layers);
  }
}

const ids = [...new Set(Object.values(config.items))];
for (const id of ids) {
  const url = `${config.portalUrl}/sharing/rest/content/items/${id}/data?f=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`${url} -> ${JSON.stringify(json.error)}`);

  sanitizeLayers(json.operationalLayers);
  if (json.baseMap) {
    json.baseMap.baseMapLayers = (json.baseMap.baseMapLayers ?? []).filter((l) => {
      const u = String(l.url ?? l.styleUrl ?? "");
      const keep = u && !u.includes("/sharing/servers/"); // portal-proxied services are not reachable cross-origin
      if (!keep) console.log(`  dropped base layer "${l.title}" (${u || "no url"})`);
      return keep;
    });
    for (const l of json.baseMap.baseMapLayers) delete l.itemId;
  }
  delete json.authoringApp;
  delete json.authoringAppVersion;

  const file = path.join(outDir, `${id}.json`);
  await writeFile(file, JSON.stringify(json), "utf8");
  const n = (json.operationalLayers ?? []).length;
  console.log(`web map ${id}: ${n} top-level layer(s), basemap "${json.baseMap?.title}" -> ${path.relative(root, file)}`);
}
