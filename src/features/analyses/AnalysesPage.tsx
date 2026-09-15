import "@esri/calcite-components/components/calcite-combobox";
import "@esri/calcite-components/components/calcite-combobox-item";
import { useEffect, useMemo, useRef, useState } from "react";
import { Leaf, PercentCircle, TreeDeciduous } from "lucide-react";
import type Graphic from "@arcgis/core/Graphic";
import { useLang, useT } from "@/i18n";
import { fmtDate, fmtNumber } from "@/i18n/format";
import { useAppStore } from "@/core/store";
import { useMapStore } from "@/features/map/mapStore";
import { Glass, KpiCard, Label, LiveRegion, Notice, Skeleton } from "@/components/ui";
import { chart as chartTokens } from "@/theme/tokens";
import { fetchContractGraphic, getContractsLayer, loadAnalysis, loadContracts, summarise, uniq, type ContractRow, type YearRow } from "@/services/analysis";
import { isAbort, Runner } from "@/services/query";
import { useAnalysisPreset } from "./useAnalysisPreset";
import { TreeCoverCharts } from "./TreeCoverCharts";
import s from "./AnalysesPage.module.css";

/** Never zoom closer than this when framing a contract (small parcels would end at a few metres). */
const MIN_ZOOM_SCALE = 5000;

type Status = "idle" | "loading" | "ready" | "error";

function readSingle(el: HTMLCalciteComboboxElement): string {
  const v = el.value;
  if (Array.isArray(v)) return v[0] ?? "";
  return v ? String(v) : "";
}

export default function AnalysesPage() {
  const t = useT();
  const lang = useLang();
  useAnalysisPreset();
  const pes = useMapStore((m) => m.pes);
  const mapReady = useMapStore((m) => m.status === "ready");
  const contractCode = useAppStore((st) => st.contractCode);
  const setContractCode = useAppStore((st) => st.setContractCode);

  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [listStatus, setListStatus] = useState<Status>("idle");
  const [org, setOrg] = useState("");
  const [project, setProject] = useState("");
  // derived status: rows belong to a contract code; a mismatch with the current one means "loading"
  const [analysis, setAnalysis] = useState<{ code: string | null; rows: YearRow[]; error: boolean }>({ code: null, rows: [], error: false });
  const runner = useMemo(() => new Runner(), []);
  const selectionRef = useRef<Graphic | null>(null);

  // contract list (waits for the map so the web map's own contracts layer can be reused)
  useEffect(() => {
    if (!mapReady) return;
    let cancelled = false;
    const layer = getContractsLayer(pes?.contracts);
    loadContracts(layer)
      .then((list) => {
        if (cancelled) return;
        setContracts(list);
        setListStatus("ready");
      })
      .catch((err) => {
        console.error("contracts query failed", err);
        if (!cancelled) setListStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [mapReady, pes]);

  const orgs = useMemo(() => uniq(contracts.map((c) => c.organisation)), [contracts]);
  const projects = useMemo(() => uniq(contracts.map((c) => c.project)), [contracts]);
  const visible = useMemo(() => contracts.filter((c) => (!org || c.organisation === org) && (!project || c.project === project)), [contracts, org, project]);
  const current = useMemo(() => contracts.find((c) => c.code === contractCode) ?? null, [contracts, contractCode]);

  // selection: zoom, outline, annual rows
  useEffect(() => {
    const { view, el } = useMapStore.getState();
    if (!current || !view || !el) {
      if (view && selectionRef.current) {
        view.graphics.remove(selectionRef.current);
        selectionRef.current = null;
      }
      return;
    }
    const signal = runner.start();
    const layer = getContractsLayer(useMapStore.getState().pes?.contracts);
    (async () => {
      try {
        const [graphic, data] = await Promise.all([fetchContractGraphic(layer, current.code, view, signal), loadAnalysis(current.code, signal)]);
        if (signal.aborted) return;
        if (graphic?.geometry) {
          await el.goTo(graphic.geometry);
          if (view.scale < MIN_ZOOM_SCALE) await el.goTo({ target: graphic.geometry.extent?.center ?? graphic.geometry, scale: MIN_ZOOM_SCALE });
          const { default: SimpleFillSymbol } = await import("@arcgis/core/symbols/SimpleFillSymbol");
          if (selectionRef.current) view.graphics.remove(selectionRef.current);
          graphic.symbol = new SimpleFillSymbol({ color: [0, 131, 0, 0.15], outline: { color: chartTokens.treeCover, width: 2 } });
          view.graphics.add(graphic);
          selectionRef.current = graphic;
        }
        setAnalysis({ code: current.code, rows: data, error: false });
      } catch (err) {
        if (isAbort(err)) return;
        console.error(err);
        setAnalysis({ code: current.code, rows: [], error: true });
      }
    })();
    return () => runner.cancel();
  }, [current, runner]);

  // leave: remove the outline
  useEffect(
    () => () => {
      const view = useMapStore.getState().view;
      if (view && selectionRef.current) view.graphics.remove(selectionRef.current);
      selectionRef.current = null;
    },
    [],
  );

  const status: Status = !current ? "idle" : analysis.code !== current.code ? "loading" : analysis.error ? "error" : "ready";
  const rows = status === "ready" ? analysis.rows : [];
  const summary = current && rows.length ? summarise(rows, current) : null;
  const description =
    current &&
    t("analyses.descriptionText", {
      code: current.code,
      beneficiary: current.beneficiaryType || "–",
      village: current.village || "–",
      country: current.country || "–",
      area: fmtNumber(current.contractedArea, 2),
      activity: current.activity || "–",
      org: current.organisation || current.acronym || "–",
      start: fmtDate(current.start),
      end: fmtDate(current.end),
    });

  return (
    <div className={s.overlay}>
      <Glass strong pad={false} className={`${s.panel} calcite-mode-dark`} aria-label={t("analyses.heading")}>
        <div className={`${s.body} scroll`}>
          <h2 className={s.heading}>{t("analyses.heading")}</h2>

          <div className={s.pickers}>
            <label className={s.field}>
              <Label>{t("analyses.organisation")}</Label>
              <calcite-combobox
                key={`org-${lang}`}
                label={t("analyses.organisation")}
                selectionMode="single"
                clearDisabled={false}
                scale="s"
                overlayPositioning="fixed"
                placeholder={t("filter.any")}
                disabled={listStatus !== "ready"}
                oncalciteComboboxChange={(e: Event) => setOrg(readSingle(e.currentTarget as HTMLCalciteComboboxElement))}
              >
                {orgs.map((v) => (
                  <calcite-combobox-item key={v} value={v} heading={v} selected={org === v} />
                ))}
              </calcite-combobox>
            </label>
            <label className={s.field}>
              <Label>{t("analyses.project")}</Label>
              <calcite-combobox
                key={`project-${lang}`}
                label={t("analyses.project")}
                selectionMode="single"
                scale="s"
                overlayPositioning="fixed"
                placeholder={t("filter.any")}
                disabled={listStatus !== "ready"}
                oncalciteComboboxChange={(e: Event) => setProject(readSingle(e.currentTarget as HTMLCalciteComboboxElement))}
              >
                {projects.map((v) => (
                  <calcite-combobox-item key={v} value={v} heading={v} selected={project === v} />
                ))}
              </calcite-combobox>
            </label>
            <label className={s.field}>
              <Label>{t("analyses.contract")}</Label>
              {listStatus === "ready" ? (
                <calcite-combobox
                  key={`contract-${lang}`}
                  label={t("analyses.contract")}
                  selectionMode="single"
                  scale="s"
                  overlayPositioning="fixed"
                  placeholder={t("analyses.select")}
                  oncalciteComboboxChange={(e: Event) => setContractCode(readSingle(e.currentTarget as HTMLCalciteComboboxElement) || null)}
                >
                  {visible.map((c) => (
                    <calcite-combobox-item
                      key={c.code}
                      value={c.code}
                      heading={c.code}
                      description={[c.acronym || c.organisation, c.village, c.country].filter(Boolean).join(" · ")}
                      selected={c.code === contractCode}
                    />
                  ))}
                </calcite-combobox>
              ) : listStatus === "error" ? (
                <Notice kind="danger">{t("analyses.error")}</Notice>
              ) : (
                <Skeleton height={30} />
              )}
            </label>
          </div>

          {!current && <p className={s.hint}>{t("analyses.empty")}</p>}

          {current && (
            <section className={s.results} aria-live="polite">
              <h3 className={s.subheading}>{t("analyses.description")}</h3>
              <p className={s.description}>{description}</p>

              {status === "loading" && (
                <div className={s.tiles} aria-hidden="true">
                  <Skeleton height={78} />
                  <Skeleton height={78} />
                  <Skeleton height={78} />
                </div>
              )}
              {status === "error" && <Notice kind="danger">{t("analyses.error")}</Notice>}
              {status === "ready" && rows.length === 0 && <Notice kind="info">{t("analyses.noData")}</Notice>}
              {status === "ready" && summary && (
                <>
                  <div className={s.tiles}>
                    <KpiCard
                      icon={<TreeDeciduous size={16} aria-hidden="true" />}
                      value={fmtNumber(summary.latest.treeCover, 2)}
                      unit={summary.latest.treeCover === null ? undefined : t("unit.ha")}
                      label={t("analyses.treeCover")}
                      note={t("analyses.inYear", { year: summary.latest.year })}
                      accent={chartTokens.treeCover}
                    />
                    <KpiCard
                      icon={<PercentCircle size={16} aria-hidden="true" />}
                      value={summary.share === null ? "–" : fmtNumber(summary.share, 1)}
                      unit={summary.share === null ? undefined : "%"}
                      label={t("analyses.treeCoverShare")}
                      note={t("analyses.ofContracted")}
                      accent={chartTokens.treeCover}
                    />
                    <KpiCard
                      icon={<Leaf size={16} aria-hidden="true" />}
                      value={fmtNumber(summary.latest.loss, 2)}
                      unit={summary.latest.loss === null ? undefined : t("unit.ha")}
                      label={t("analyses.treeCoverLoss")}
                      note={t("analyses.inYear", { year: summary.latest.year })}
                      accent={chartTokens.loss}
                    />
                  </div>
                  <TreeCoverCharts rows={rows} />
                  <p className={s.source}>{t("analyses.source")}</p>
                </>
              )}
            </section>
          )}

          <Notice kind="info" title={t("analyses.comingSoon")}>
            {t("analyses.comingSoonList")}
          </Notice>
        </div>
      </Glass>
      <LiveRegion>{status === "loading" ? t("analyses.loading") : ""}</LiveRegion>
    </div>
  );
}
