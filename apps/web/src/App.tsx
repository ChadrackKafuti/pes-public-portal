import { useEffect, useState } from "react";
import { HashRouter, NavLink, Route, Routes } from "react-router";
import { MapStage } from "./map/MapStage";
import { ApplicationsPage } from "./screens/ApplicationsPage";
import { DossierPage } from "./screens/DossierPage";
import { RunsPage } from "./screens/RunsPage";
import { useI18n, useT } from "./i18n";
import { authEnabled, useAuth } from "./auth";

type ApiHealth = "checking" | "up" | "down";

export function App() {
  const [apiHealth, setApiHealth] = useState<ApiHealth>("checking");
  const t = useT();
  const { locale, setLocale } = useI18n();
  const { ready, user, login, logout } = useAuth();

  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/health", { signal: ctrl.signal })
      .then((r) => setApiHealth(r.ok ? "up" : "down"))
      .catch(() => setApiHealth("down"));
    return () => ctrl.abort();
  }, []);

  if (authEnabled && ready && !user) {
    return (
      <div className="shell signin">
        <div className="signin-card">
          <strong>CAFI RS Platform</strong>
          <p className="muted">{t("signin_hint")}</p>
          <button className="map-popup-btn" onClick={login}>
            {t("sign_in")}
          </button>
        </div>
      </div>
    );
  }

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
            {authEnabled && user && (
              <>
                <span className="muted small">{user.profile.preferred_username}</span>
                <button className="lang" onClick={logout}>
                  {t("sign_out")}
                </button>
              </>
            )}
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
