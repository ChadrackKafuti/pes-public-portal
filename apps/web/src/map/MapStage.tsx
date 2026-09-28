import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";

/** Congo Basin extent used by portal-v1 (WGS84). */
const CONGO_BASIN: [[number, number], [number, number]] = [
  [5, -14],
  [32, 12],
];

/**
 * The single shared map, MapLibre edition. Same pattern as portal-v1's
 * MapStage: mounted once by the shell, pages overlay panels on it.
 * Layers will be added from the API's tile endpoints as they come online.
 */
export function MapStage() {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) return;
    const map = new maplibregl.Map({
      container: container.current,
      // Free, key-less demo style for the skeleton; swapped for the platform
      // style (self-hosted glyphs/sprites + basemap choice) in P1.
      style: "https://demotiles.maplibre.org/style.json",
      bounds: CONGO_BASIN,
      fitBoundsOptions: { padding: 24 },
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }));
    map.addControl(new maplibregl.ScaleControl());
    return () => map.remove();
  }, []);

  return <div ref={container} className="map-stage" />;
}
