import { Link } from "react-router";
import { useT } from "../i18n";

/** M7e — the v1 landing hero: kicker, title, lead, the two entry CTAs and
 *  the data-attribution footer. The map itself lives at /map. */
export function LandingPage() {
  const t = useT();
  return (
    <main className="landing">
      <section className="landing-hero">
        <p className="landing-kicker">{t("landing_kicker")}</p>
        <h1 className="landing-title">{t("landing_title")}</h1>
        <p className="landing-lead">{t("landing_lead")}</p>
        <div className="landing-ctas">
          <Link className="btn" to="/map">
            {t("landing_cta_map")}
          </Link>
          <Link className="btn btn-secondary" to="/analyses">
            {t("landing_cta_analyses")}
          </Link>
        </div>
      </section>
      <p className="landing-foot muted small">{t("landing_footer")}</p>
    </main>
  );
}
