import { useNavigate } from "react-router";
import { Map as MapIcon, BarChart3 } from "lucide-react";
import { useT } from "@/i18n";
import { Button } from "@/components/ui";
import s from "./LandingPage.module.css";

/** Landing page. Phase 5 adds the spinning-globe hero; this is the static hero used as its fallback. */
export default function LandingPage() {
  const t = useT();
  const navigate = useNavigate();
  return (
    <div className={s.page}>
      <section className={s.hero}>
        <p className={s.kicker}>{t("landing.kicker")}</p>
        <h2 className={s.title}>{t("landing.title")}</h2>
        <p className={s.lead}>{t("landing.lead")}</p>
        <div className={s.ctas}>
          <Button size="lg" icon={<MapIcon size={18} aria-hidden="true" />} onClick={() => navigate("/map")}>
            {t("landing.cta")}
          </Button>
          <Button size="lg" variant="secondary" icon={<BarChart3 size={18} aria-hidden="true" />} onClick={() => navigate("/analyses")}>
            {t("landing.ctaAnalyses")}
          </Button>
        </div>
      </section>
    </div>
  );
}
