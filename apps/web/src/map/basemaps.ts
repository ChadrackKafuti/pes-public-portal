import type { StyleSpecification } from "maplibre-gl";

/** Key-free raster basemaps (portal-v1 already ships Esri + OSM tiles). */
function rasterStyle(id: string, tiles: string[], attribution: string): StyleSpecification {
  return {
    version: 8,
    sources: {
      [id]: { type: "raster", tiles, tileSize: 256, attribution, maxzoom: 19 },
    },
    layers: [{ id, type: "raster", source: id }],
  };
}

export const BASEMAPS = {
  streets: rasterStyle(
    "osm",
    ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
    "© OpenStreetMap contributors",
  ),
  imagery: rasterStyle(
    "esri-imagery",
    [
      "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    ],
    "Esri, Maxar, Earthstar Geographics",
  ),
} as const;

export type BasemapId = keyof typeof BASEMAPS;
