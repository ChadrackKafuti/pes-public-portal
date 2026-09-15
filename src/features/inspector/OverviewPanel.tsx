import { useT } from "@/i18n";
import { useMapStore } from "@/features/map/mapStore";
import { FeaturePanel } from "./FeaturePanel";
import s from "./OverviewPanel.module.css";

/** Overview tab: the selected feature, otherwise the empty hint (Phase 3 puts the KPI dashboard here). */
export function OverviewPanel() {
  const t = useT();
  const graphic = useMapStore((m) => m.selectedGraphic);
  if (graphic) return <FeaturePanel />;
  return <p className={s.hint}>{t("info.empty")}</p>;
}
