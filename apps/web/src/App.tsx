import { useEffect, useState } from "react";
import { MapStage } from "./map/MapStage";

type ApiHealth = "checking" | "up" | "down";

export function App() {
  const [api, setApi] = useState<ApiHealth>("checking");

  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/health", { signal: ctrl.signal })
      .then((r) => setApi(r.ok ? "up" : "down"))
      .catch(() => setApi("down"));
    return () => ctrl.abort();
  }, []);

  return (
    <div className="shell">
      <header className="topbar">
        <strong>CAFI RS Platform</strong>
        <span className={`api-badge api-${api}`}>
          API: {api === "checking" ? "…" : api}
        </span>
      </header>
      <MapStage />
    </div>
  );
}
