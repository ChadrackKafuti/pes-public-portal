/** Placeholder stage; Phase 1 replaces it with the shared <arcgis-map>. */
export default function MapStage() {
  return <div style={{ position: "absolute", inset: 0, background: "var(--map-bg-gradient)" }} aria-hidden="true" />;
}
