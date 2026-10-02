import { useEffect, useState } from "react";
import { HashRouter, NavLink, Route, Routes, useLocation } from "react-router";
import { MapStage } from "./map/MapStage";
import { AlertsPage } from "./screens/AlertsPage";
import { AnalysesPage } from "./screens/AnalysesPage";
import { DossierPage } from "./screens/DossierPage";
import { LandingPage } from "./screens/LandingPage";
import { RunsPage } from "./screens/RunsPage";
import { useI18n, useT } from "./i18n";
import { authEnabled, authMode, useAuth } from "./auth";
import { demoEnabled } from "./api/demo";

const APP_VERSION = "2.0.0";

/* Inline nav icons (lucide-style strokes, 24px viewBox, drawn at 16px). */
const I = {
  home: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1V10Z" strokeLinejoin="round" />
    </svg>
  ),
  map: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z" strokeLinejoin="round" />
      <path d="M9 4v14M15 6v14" />
    </svg>
  ),
  applications: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" strokeLinecap="round" />
    </svg>
  ),
  dashboard: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" strokeLinecap="round" />
    </svg>
  ),
  analyses: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3 20h18M5 17c2-6 4-9 6-9s3 2 4 5 2 4 4 4" strokeLinecap="round" />
    </svg>
  ),
  alerts: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 3 2.5 20h19L12 3Z" strokeLinejoin="round" />
      <path d="M12 10v5M12 17.5v.5" strokeLinecap="round" />
    </svg>
  ),
  runs: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M2 12h4l3-7 4 14 3-7h6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

/** Ground-Impact-style account control: an avatar pill opening a dropdown
 *  card with the user's identity and a red sign-out row. */
function AccountMenu() {
  const t = useT();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  if (!authEnabled || !user) return null;
  const handle = user.profile.preferred_username ?? "—";
  const name = handle.split("@")[0];
  const initials =
    name
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]!.toUpperCase())
      .join("") || "U";
  return (
    <div className="account">
      <button
        className="account-pill"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="account-avatar">{initials}</span>
        <span className="account-name">{name}</span>
        <span className="account-chev" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div className="account-menu" role="menu" onMouseLeave={() => setOpen(false)}>
          <div className="account-id">
            <span className="account-avatar account-avatar-lg">{initials}</span>
            <div className="account-who">
              <strong>{name}</strong>
              {handle.includes("@") && <span className="account-mail">{handle}</span>}
              <span className="account-online">● {t("online")}</span>
            </div>
          </div>
          <button className="account-signout" role="menuitem" onClick={logout}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4" strokeLinecap="round" />
              <path d="M14 8l4 4-4 4M18 12H9" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {t("sign_out")}
          </button>
        </div>
      )}
    </div>
  );
}

function LangToggle() {
  const t = useT();
  const { locale, setLocale } = useI18n();
  return (
    <div className="lang-group" role="group" aria-label={t("lang_label")}>
      {(["en", "fr"] as const).map((l) => (
        <button
          key={l}
          className="lang-item"
          aria-pressed={locale === l}
          onClick={() => setLocale(l)}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function Brand() {
  const t = useT();
  return (
    <NavLink to="/" className="brand" aria-label="CAFI Monitor">
      <img src="branding/cafi-monitor-icon.png" width="36" height="36" alt="" />
      <span>
        <strong>CAFI Monitor</strong>
        <small>{t("app_subtitle")}</small>
      </span>
    </NavLink>
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

/** v1 shell layout: the single map stage is mounted once and kept alive;
 *  the Map and Analyses routes only overlay panels on it. */
function Shell({ apiHealth }: { apiHealth: ApiHealth }) {
  const t = useT();
  const { pathname } = useLocation();
  const mapVisible = pathname === "/map" || pathname === "/analyses";

  const nav: { to: string; end?: boolean; icon: keyof typeof I; label: string }[] = [
    { to: "/", end: true, icon: "home", label: t("nav_home") },
    { to: "/map", icon: "map", label: t("nav_map") },
    { to: "/analyses", icon: "analyses", label: t("nav_analyses") },
    { to: "/alerts", icon: "alerts", label: t("nav_alerts") },
    { to: "/runs", icon: "runs", label: t("nav_runs") },
  ];

  return (
    <div className="shell" data-surface={mapVisible ? "dark" : "light"}>
      <a className="skip" href="#main">
        {t("app_skip")}
      </a>
      <header className="topbar">
        <Brand />
        <nav className="nav" aria-label={t("nav_main")}>
          {nav.map((r) => (
            <NavLink key={r.to} to={r.to} end={r.end} title={r.label}>
              {I[r.icon]}
              <span>{r.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="tools">
          <LangToggle />
          <AccountMenu />
          {demoEnabled ? (
            <span className="api-badge api-demo" title={t("demo_hint")}>
              {t("demo_badge")}
            </span>
          ) : (
            <span className={`api-badge api-${apiHealth}`}>
              API: {apiHealth === "checking" ? "…" : apiHealth}
            </span>
          )}
        </div>
      </header>
      <main id="main" className="main">
        <div className="stage" hidden={!mapVisible}>
          <MapStage showPanel={pathname === "/map"} visible={mapVisible} />
        </div>
        <div className="route-layer" data-overlay={mapVisible}>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/map" element={null} />
            <Route path="/analyses" element={<AnalysesPage />} />
            <Route path="/alerts" element={<AlertsPage />} />
            {/* the dossier stays reachable (alerts links, print/export) but is
                no longer in the nav — selections open in the map panel */}
            <Route path="/applications/:id" element={<DossierPage />} />
            <Route path="/runs" element={<RunsPage />} />
          </Routes>
        </div>
      </main>
      <footer className="footer">
        <span>{t("footer_data")}</span>
        <span className="spacer" />
        <span>
          {t("footer_version")} {APP_VERSION}
        </span>
      </footer>
    </div>
  );
}

export function App() {
  const [apiHealth, setApiHealth] = useState<ApiHealth>("checking");
  const t = useT();
  const { ready, user, login } = useAuth();

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
            <div className="brand signin-brand-row">
              <img src="branding/cafi-monitor-icon.png" width="36" height="36" alt="" />
              <span>
                <strong>CAFI Monitor</strong>
                <small>{t("app_subtitle")}</small>
              </span>
            </div>
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

  return (
    <HashRouter>
      <Shell apiHealth={apiHealth} />
    </HashRouter>
  );
}
