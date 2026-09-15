import { useT } from "@/i18n";
import { Glass } from "@/components/ui";

/** Placeholder until Phase 1 adds the side panel, filters, inspector and search. */
export default function MapPage() {
  const t = useT();
  return (
    <div style={{ position: "absolute", left: 16, top: 16, pointerEvents: "auto" }}>
      <Glass strong>
        <strong>{t("nav.map")}</strong>
      </Glass>
    </div>
  );
}
