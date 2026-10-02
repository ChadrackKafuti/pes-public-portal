import { Link } from "react-router";
import { useT } from "../i18n";

/** v1 landing hero: centred kicker/title/lead on the deep-blue gradient,
 *  with the two entry CTAs. The data attribution lives in the shell footer. */
export function LandingPage() {
  const t = useT();
  return (
    <div className="landing">
      <section className="landing-hero">
        <p className="landing-kicker">{t("landing_kicker")}</p>
        <h2 className="landing-title">{t("landing_title")}</h2>
        <p className="landing-lead">{t("landing_lead")}</p>
        <div className="landing-ctas">
          <Link className="btn btn-lg" to="/map">
            {t("landing_cta_map")}
          </Link>
          <Link className="btn btn-lg btn-secondary" to="/analyses">
            {t("landing_cta_analyses")}
          </Link>
        </div>
      </section>
    </div>
  );
}
