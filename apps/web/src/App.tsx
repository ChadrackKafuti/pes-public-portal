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

/* Inline nav icons (stroke style, 24px viewBox) — no icon library. */
const I = {
  map: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z" strokeLinejoin="round" />
      <path d="M9 4v14M15 6v14" />
    </svg>
  ),
  applications: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" strokeLinecap="round" />
    </svg>
  ),
  dashboard: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" strokeLinecap="round" />
    </svg>
  ),
  alerts: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M12 3 2.5 20h19L12 3Z" strokeLinejoin="round" />
      <path d="M12 10v5M12 17.5v.5" strokeLinecap="round" />
    </svg>
  ),
  runs: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M2 12h4l3-7 4 14 3-7h6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

function Brand({ sub }: { sub: string }) {
  return (
    <div className="brand">
      <span className="brand-title">CAFI RS Platform</span>
      <span className="brand-sub">{sub}</span>
    </div>
  );
}

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
      <button className="btn" type="submit" disabled={busy}>
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
          <div className="signin-brand">
            <Brand sub={t("app_subtitle")} />
            <p>{t("brand_mission")}</p>
          </div>
          <div className="signin-main">
            <p className="muted small">
              {t(authMode === "supabase" ? "signin_hint_supabase" : "signin_hint")}
            </p>
            {authMode === "supabase" ? (
              <SupabaseSignIn />
            ) : (
              <button className="btn" onClick={login}>
                {t("sign_in")}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const rail: { to: string; end?: boolean; icon: keyof typeof I; label: string }[] = [
    { to: "/", end: true, icon: "map", label: t("nav_map") },
    { to: "/applications", icon: "applications", label: t("nav_applications") },
    { to: "/dashboard", icon: "dashboard", label: t("nav_dashboard") },
    { to: "/alerts", icon: "alerts", label: t("nav_alerts") },
    { to: "/runs", icon: "runs", label: t("nav_runs") },
  ];

  return (
    <HashRouter>
      <div className="shell">
        <header className="topbar">
          <Brand sub={t("app_subtitle")} />
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
        <div className="shell-body">
          <nav className="rail" aria-label={t("nav_main")}>
            {rail.map((r) => (
              <NavLink key={r.to} to={r.to} end={r.end} title={r.label}>
                {I[r.icon]}
                <span>{r.label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="content">
            <Routes>
              <Route path="/" element={<MapStage />} />
              <Route path="/applications" element={<ApplicationsPage />} />
              <Route path="/applications/:id" element={<DossierPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/alerts" element={<AlertsPage />} />
              <Route path="/map" element={<MapStage />} />
              <Route path="/runs" element={<RunsPage />} />
            </Routes>
          </div>
        </div>
      </div>
    </HashRouter>
  );
}
