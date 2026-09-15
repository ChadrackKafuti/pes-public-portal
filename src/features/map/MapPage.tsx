import { Filter, Layers, LayoutDashboard, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useT } from "@/i18n";
import { activeFilterCount, useAppStore, type PanelTab } from "@/core/store";
import { useIsNarrow } from "@/core/hooks";
import { BottomSheet, Glass, IconButton, Tabs } from "@/components/ui";
import { OverviewPanel } from "@/features/inspector/OverviewPanel";
import { FiltersPanel } from "@/features/filters/FiltersPanel";
import { useApplyFilters } from "@/features/filters/useApplyFilters";
import { LayersPanel } from "./LayersPanel";
import s from "./MapPage.module.css";

export default function MapPage() {
  const t = useT();
  const tab = useAppStore((st) => st.tab);
  const setTab = useAppStore((st) => st.setTab);
  const open = useAppStore((st) => st.panelOpen);
  const setOpen = useAppStore((st) => st.setPanelOpen);
  const snap = useAppStore((st) => st.sheetSnap);
  const setSnap = useAppStore((st) => st.setSheetSnap);
  const active = useAppStore((st) => activeFilterCount(st.applied));
  const narrow = useIsNarrow();
  const count = useApplyFilters();

  const tabs = [
    { id: "overview" as PanelTab, label: t("panel.overview"), icon: <LayoutDashboard size={15} aria-hidden="true" /> },
    { id: "filters" as PanelTab, label: t("panel.filters"), icon: <Filter size={15} aria-hidden="true" />, badge: active || undefined },
    { id: "layers" as PanelTab, label: t("panel.layers"), icon: <Layers size={15} aria-hidden="true" /> },
  ];

  const content = (
    <>
      <Tabs items={tabs} value={tab} onChange={setTab} ariaLabel={t("nav.map")} />
      <div className={`${s.body} scroll`}>
        <section role="tabpanel" id="panel-overview" aria-labelledby="tab-overview" hidden={tab !== "overview"}>
          <OverviewPanel />
        </section>
        <section role="tabpanel" id="panel-filters" aria-labelledby="tab-filters" hidden={tab !== "filters"}>
          <FiltersPanel count={count} />
        </section>
        <section role="tabpanel" id="panel-layers" aria-labelledby="tab-layers" hidden={tab !== "layers"}>
          <LayersPanel />
        </section>
      </div>
    </>
  );

  if (narrow) {
    return (
      <div className={s.overlay}>
        <BottomSheet snap={snap} onSnap={setSnap} label={t("nav.map")}>
          {content}
        </BottomSheet>
      </div>
    );
  }

  return (
    <div className={s.overlay}>
      <Glass strong pad={false} className={`${s.panel} ${open ? "" : s.collapsed}`} aria-label={t("nav.map")}>
        <IconButton
          className={s.toggle}
          label={open ? t("panel.collapse") : t("panel.expand")}
          onClick={() => setOpen(!open)}
        >
          {open ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
        </IconButton>
        {open && content}
      </Glass>
    </div>
  );
}
