import { Suspense, lazy } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { BarChart3, Map as MapIcon, AlertTriangle, Home } from "lucide-react";
import { useT } from "@/i18n";
import { LangToggle } from "@/components/ui/LangToggle";
import { Spinner, VisuallyHidden } from "@/components/ui";
import { CONFIG } from "@/config";
import s from "./AppShell.module.css";

const MapStage = lazy(() => import("@/features/map/MapStage"));

/** Routes that show the shared map view underneath their panels. */
const MAP_ROUTES = new Set(["/map", "/analyses"]);

export default function AppShell() {
  const t = useT();
  const { pathname } = useLocation();
  const mapVisible = MAP_ROUTES.has(pathname);
  const dark = mapVisible;

  return (
    <div className={s.shell} data-surface={dark ? "dark" : "light"}>
      <a className={s.skip} href="#main">
        {t("app.skip")}
      </a>
      <header className={s.topbar}>
        <NavLink to="/" className={s.brand} aria-label={t("app.title")}>
          <img src="branding/cafi-monitor-icon.png" alt="" width={36} height={36} />
          <span>
            <strong>{t("app.title")}</strong>
            <small>{t("app.subtitle")}</small>
          </span>
        </NavLink>
        <nav className={s.nav} aria-label={t("nav.menu")}>
          <NavLink to="/" end className={({ isActive }) => (isActive ? s.active : undefined)}>
            <Home size={16} aria-hidden="true" /> <span>{t("nav.landing")}</span>
          </NavLink>
          <NavLink to="/map" className={({ isActive }) => (isActive ? s.active : undefined)}>
            <MapIcon size={16} aria-hidden="true" /> <span>{t("nav.map")}</span>
          </NavLink>
          <NavLink to="/analyses" className={({ isActive }) => (isActive ? s.active : undefined)}>
            <BarChart3 size={16} aria-hidden="true" /> <span>{t("nav.analyses")}</span>
          </NavLink>
          <NavLink to="/alerts" className={({ isActive }) => (isActive ? s.active : undefined)}>
            <AlertTriangle size={16} aria-hidden="true" /> <span>{t("nav.alerts")}</span>
          </NavLink>
        </nav>
        <div className={s.tools}>
          <LangToggle />
          <img className={s.partner} src="branding/cafi-logo.png" alt="CAFI" />
          <img className={s.partner} src="branding/undp-logo.svg" alt="UNDP" />
        </div>
      </header>

      <main id="main" className={s.main}>
        <VisuallyHidden as="h1">{t("app.title")}</VisuallyHidden>
        {/* The map stage is mounted once and kept alive; routes overlay it or hide it. */}
        <div className={s.stage} hidden={!mapVisible} inert={!mapVisible}>
          <Suspense fallback={<div className={s.stageLoading}><Spinner label={t("map.loading")} /></div>}>
            <MapStage />
          </Suspense>
        </div>
        <div className={s.routeLayer} data-overlay={mapVisible}>
          <Suspense fallback={<div className={s.stageLoading}><Spinner label={t("ui.loading")} /></div>}>
            <Outlet />
          </Suspense>
        </div>
      </main>
      <footer className={s.footer}>
        <span>{t("footer.data")}</span>
        <span className={s.spacer} />
        <span>
          {t("footer.version")} {CONFIG.appVersion}
        </span>
      </footer>
    </div>
  );
}
