import { useEffect, useState } from "react";
import { HashRouter, NavLink, Route, Routes } from "react-router";
import { MapStage } from "./map/MapStage";
import { ApplicationsPage } from "./screens/ApplicationsPage";
import { DossierPage } from "./screens/DossierPage";
import { RunsPage } from "./screens/RunsPage";
import { useI18n, useT } from "./i18n";

type ApiHealth = "checking" | "up" | "down";

export function App() {
  const [apiHealth, setApiHealth] = useState<ApiHealth>("checking");
  const t = useT();
  const { locale, setLocale } = useI18n();

  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/health", { signal: ctrl.signal })
      .then((r) => setApiHealth(r.ok ? "up" : "down"))
      .catch(() => setApiHealth("down"));
    return () => ctrl.abort();
  }, []);

  return (
    <HashRouter>
      <div className="shell">
        <header className="topbar">
          <strong>CAFI RS Platform</strong>
          <nav className="nav">
            <NavLink to="/" end>
              {t("nav_applications")}
            </NavLink>
            <NavLink to="/map">{t("nav_map")}</NavLink>
            <NavLink to="/runs">{t("nav_runs")}</NavLink>
          </nav>
          <span className="topbar-right">
            <button
              className="lang"
              onClick={() => setLocale(locale === "en" ? "fr" : "en")}
              aria-label="Switch language"
            >
              {locale === "en" ? "FR" : "EN"}
            </button>
            <span className={`api-badge api-${apiHealth}`}>
              API: {apiHealth === "checking" ? "…" : apiHealth}
            </span>
          </span>
        </header>
        <Routes>
          <Route path="/" element={<ApplicationsPage />} />
          <Route path="/applications/:id" element={<DossierPage />} />
          <Route path="/map" element={<MapStage />} />
          <Route path="/runs" element={<RunsPage />} />
        </Routes>
      </div>
    </HashRouter>
  );
}
