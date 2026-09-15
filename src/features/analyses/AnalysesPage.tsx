import { useT } from "@/i18n";
import { Glass } from "@/components/ui";

/** Placeholder until Phase 2 ports the contract analysis onto the shared map view. */
export default function AnalysesPage() {
  const t = useT();
  return (
    <div style={{ position: "absolute", left: 16, top: 16, pointerEvents: "auto" }}>
      <Glass strong>
        <strong>{t("analyses.heading")}</strong>
        <p style={{ margin: "6px 0 0", opacity: 0.8 }}>{t("analyses.empty")}</p>
      </Glass>
    </div>
  );
}
