import { useEffect, useState } from "react";
import { HashRouter, NavLink, Route, Routes } from "react-router";
import { MapStage } from "./map/MapStage";
import { ApplicationsPage } from "./screens/ApplicationsPage";
import { AlertsPage } from "./screens/AlertsPage";
import { DashboardPage } from "./screens/DashboardPage";
import { DossierPage } from "./screens/DossierPage";
import { RunsPage } from "./screens/RunsPage";
import { useI18n, useT } from "./i18n";
import { authEnabled, authMode, useAuth } from "./auth";
import { demoEnabled } from "./api/demo";

function SupabaseSignIn() {
  const t = useT();
  const signIn = useAuth((s) => s.signInWithPassword);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="signin-form"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        void signIn(email, password).then((err) => {
          setError(err);
          setBusy(false);
        });
      }}
    >
      <input
        id="signin-email"
        type="email"
        required
        autoComplete="username"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={t("email")}
        aria-label={t("email")}
      />
      <input
        id="signin-password"
        type="password"
        required
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={t("password")}
        aria-label={t("password")}
      />
      {error && <p className="signin-error">{error}</p>}
      <button className="map-popup-btn" type="submit" disabled={busy}>
        {t("sign_in")}
      </button>
    </form>
  );
}

type ApiHealth = "checking" | "up" | "down";

export function App() {
  const [apiHealth, setApiHealth] = useState<ApiHealth>("checking");
  const t = useT();
  const { locale, setLocale } = useI18n();
  const { ready, user, login, logout } = useAuth();

  useEffect(() => {
    if (demoEnabled) return;
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
          <p className="muted">
            {t(authMode === "supabase" ? "signin_hint_supabase" : "signin_hint")}
          </p>
          {authMode === "supabase" ? (
            <SupabaseSignIn />
          ) : (
            <button className="map-popup-btn" onClick={login}>
              {t("sign_in")}
            </button>
          )}
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
            <NavLink to="/dashboard">{t("nav_dashboard")}</NavLink>
            <NavLink to="/alerts">{t("nav_alerts")}</NavLink>
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
            {demoEnabled ? (
              <span className="api-badge api-demo" title={t("demo_hint")}>
                {t("demo_badge")}
              </span>
            ) : (
              <span className={`api-badge api-${apiHealth}`}>
                API: {apiHealth === "checking" ? "…" : apiHealth}
              </span>
            )}
          </span>
        </header>
        <Routes>
          <Route path="/" element={<ApplicationsPage />} />
          <Route path="/applications/:id" element={<DossierPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/alerts" element={<AlertsPage />} />
          <Route path="/map" element={<MapStage />} />
          <Route path="/runs" element={<RunsPage />} />
        </Routes>
      </div>
    </HashRouter>
  );
}
