import { AlertTriangle } from "lucide-react";
import { useT } from "@/i18n";
import { Card } from "@/components/ui";
import s from "./AlertsPage.module.css";

export default function AlertsPage() {
  const t = useT();
  return (
    <div className={s.page}>
      <Card title={t("alerts.heading")} icon={<AlertTriangle className={s.icon} aria-hidden="true" />}>
        <p>{t("alerts.text")}</p>
        <p className={s.soon}>{t("alerts.soon")}</p>
      </Card>
    </div>
  );
}
