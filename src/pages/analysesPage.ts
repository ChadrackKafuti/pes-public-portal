/** Analyses page: contract picker, annual tree-cover statistics and charts, contract map. */
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import type Graphic from "@arcgis/core/Graphic";
import { Chart, BarController, BarElement, LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip } from "chart.js";
import { CONFIG } from "../config";
import { t, fmtNumber, fmtDate, applyTranslations } from "../i18n";
import { loadWebMap } from "../webmap";

Chart.register(BarController, BarElement, LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip);

const $ = <T extends Element>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Missing element ${sel}`);
  return el;
};

interface ContractRow {
  code: string;
  organisation: string;
  acronym: string;
  project: string;
  village: string;
  country: string;
  province: string;
  beneficiaryType: string;
  activity: string;
  contractedArea: number | null;
  start: number | null;
  end: number | null;
}

interface YearRow {
  year: number;
  treeCover: number | null;
  loss: number | null;
  parcelArea: number | null;
}

/** Chart colours: single-series charts, hues from the validated reference palette; text stays in ink tokens. */
const COLOR_TREE_COVER = "#008300";
const COLOR_LOSS = "#eb6834";
const INK_SECONDARY = "#52514e";
const GRID = "rgba(0,0,0,0.08)";
/** Never zoom closer than this when framing a contract (small parcels would end at a few metres). */
const MIN_ZOOM_SCALE = 5000;

export class AnalysesPage {
  private mapEl = $<HTMLArcgisMapElement>("#analyses-map");
  private contractsLayer = new FeatureLayer({ url: CONFIG.contractsLayerUrl, outFields: ["*"] });
  private analysisTable = new FeatureLayer({ url: CONFIG.analysisTableUrl, outFields: ["*"] });
  private contracts: ContractRow[] = [];
  private charts: Chart[] = [];
  private highlight: { remove(): void } | null = null;
  private current: ContractRow | null = null;
  private rows: YearRow[] = [];
  private started = false;

  start(): void {
    if (this.started) return;
    this.started = true;
    loadWebMap(CONFIG.webmaps.analyses)
      .then((webmap) => {
        this.mapEl.map = webmap;
      })
      .catch((err) => console.error(err));
    void this.loadContracts();
    $<HTMLCalciteComboboxElement>("#an-org").addEventListener("calciteComboboxChange", () => this.refreshPickers());
    $<HTMLCalciteComboboxElement>("#an-project").addEventListener("calciteComboboxChange", () => this.refreshPickers());
    $<HTMLCalciteComboboxElement>("#an-contract").addEventListener("calciteComboboxChange", () => void this.selectContract());
    document.addEventListener("pes-lang-change", () => {
      applyTranslations($("#page-analyses"));
      if (this.current) this.render(this.current, this.rows);
    });
  }

  // ---------------------------------------------------------------- contracts
  private async loadContracts(): Promise<void> {
    const f = CONFIG.contractFields;
    try {
      const result = await this.contractsLayer.queryFeatures({
        where: "1=1",
        outFields: Object.values(f),
        returnGeometry: false,
        orderByFields: [f.code],
        num: 5000,
      });
      this.contracts = result.features
        .map((g) => g.attributes)
        .filter((a) => a[f.code])
        .map((a) => ({
          code: String(a[f.code]),
          organisation: String(a[f.organisation] ?? ""),
          acronym: String(a[f.acronym] ?? ""),
          project: String(a[f.project] ?? ""),
          village: String(a[f.village] ?? ""),
          country: String(a[f.country] ?? ""),
          province: String(a[f.province] ?? ""),
          beneficiaryType: String(a[f.beneficiaryType] ?? ""),
          activity: String(a[f.activity] ?? ""),
          contractedArea: numberOrNull(a[f.contractedArea]),
          start: numberOrNull(a[f.start]),
          end: numberOrNull(a[f.end]),
        }));
    } catch (err) {
      console.error("contracts query failed", err);
      this.contracts = [];
    }
    this.fill($<HTMLCalciteComboboxElement>("#an-org"), uniq(this.contracts.map((c) => c.organisation)));
    this.fill($<HTMLCalciteComboboxElement>("#an-project"), uniq(this.contracts.map((c) => c.project)));
    this.refreshPickers();
  }

  private refreshPickers(): void {
    const org = single($<HTMLCalciteComboboxElement>("#an-org"));
    const project = single($<HTMLCalciteComboboxElement>("#an-project"));
    const list = this.contracts.filter((c) => (!org || c.organisation === org) && (!project || c.project === project));
    const box = $<HTMLCalciteComboboxElement>("#an-contract");
    const keep = single(box);
    box.innerHTML = "";
    for (const c of list) {
      const item = document.createElement("calcite-combobox-item");
      item.value = c.code;
      item.heading = c.code;
      item.description = [c.acronym || c.organisation, c.village, c.country].filter(Boolean).join(" · ");
      item.selected = c.code === keep;
      box.appendChild(item);
    }
  }

  private fill(box: HTMLCalciteComboboxElement, values: string[]): void {
    box.innerHTML = "";
    for (const v of values) {
      const item = document.createElement("calcite-combobox-item");
      item.value = v;
      item.heading = v;
      box.appendChild(item);
    }
  }

  // ---------------------------------------------------------------- selection
  private async selectContract(): Promise<void> {
    const code = single($<HTMLCalciteComboboxElement>("#an-contract"));
    const contract = this.contracts.find((c) => c.code === code) ?? null;
    this.current = contract;
    const empty = $<HTMLCalciteNoticeElement>("#an-empty");
    const results = $<HTMLElement>("#an-results");
    if (!contract) {
      empty.open = true;
      results.hidden = true;
      this.highlight?.remove();
      return;
    }
    empty.open = false;
    results.hidden = false;
    $<HTMLElement>("#an-status").textContent = t("analyses.loading");
    await Promise.all([this.zoomTo(contract.code), this.loadAnalysis(contract.code)]);
    $<HTMLElement>("#an-status").textContent = "";
    this.render(contract, this.rows);
  }

  private async zoomTo(code: string): Promise<void> {
    try {
      const f = CONFIG.contractFields;
      const result = await this.contractsLayer.queryFeatures({
        where: `${f.code} = '${code.replaceAll("'", "''")}'`,
        outFields: [f.code],
        returnGeometry: true,
        outSpatialReference: this.mapEl.view?.spatialReference ?? undefined,
      });
      const g = result.features[0];
      if (!g?.geometry) return;
      await this.mapEl.goTo(g.geometry);
      const view = this.mapEl.view;
      if (view && view.scale < MIN_ZOOM_SCALE) {
        await this.mapEl.goTo({ target: g.geometry.extent?.center ?? g.geometry, scale: MIN_ZOOM_SCALE });
      }
      this.drawSelection(g);
    } catch (err) {
      console.warn("zoom failed", err);
    }
  }

  private drawSelection(g: Graphic): void {
    const view = this.mapEl.view;
    if (!view) return;
    view.graphics.removeAll();
    g.symbol = new SimpleFillSymbol({
      color: [0, 131, 0, 0.15],
      outline: { color: [0, 131, 0, 1], width: 2 },
    });
    view.graphics.add(g);
  }

  private async loadAnalysis(code: string): Promise<void> {
    const f = CONFIG.analysisFields;
    this.rows = [];
    try {
      const result = await this.analysisTable.queryFeatures({
        where: `${f.contract} = '${code.replaceAll("'", "''")}'`,
        outFields: [f.year, f.treeCover, f.treeCoverLoss, f.parcelArea],
        returnGeometry: false,
        orderByFields: [f.year],
        num: 200,
      });
      this.rows = result.features
        .map((g) => g.attributes)
        .filter((a) => a[f.year] !== null && a[f.year] !== undefined)
        .map((a) => ({
          year: Number(a[f.year]),
          treeCover: numberOrNull(a[f.treeCover]),
          loss: numberOrNull(a[f.treeCoverLoss]),
          parcelArea: numberOrNull(a[f.parcelArea]),
        }));
    } catch (err) {
      console.error("analysis query failed", err);
    }
  }

  // ---------------------------------------------------------------- render
  private render(contract: ContractRow, rows: YearRow[]): void {
    const noData = $<HTMLCalciteNoticeElement>("#an-nodata");
    const stats = $<HTMLElement>("#an-stats");
    const chartsHost = $<HTMLElement>("#an-charts");
    noData.open = rows.length === 0;
    stats.hidden = rows.length === 0;
    chartsHost.hidden = rows.length === 0;

    // description (always)
    $<HTMLElement>("#an-description").textContent = t("analyses.descriptionText", {
      code: contract.code,
      beneficiary: contract.beneficiaryType || "–",
      village: contract.village || "–",
      country: contract.country || "–",
      area: fmtNumber(contract.contractedArea, 2),
      activity: contract.activity || "–",
      org: contract.organisation || contract.acronym || "–",
      start: fmtDate(contract.start),
      end: fmtDate(contract.end),
    });

    if (rows.length === 0) {
      this.destroyCharts();
      return;
    }
    const latest = rows[rows.length - 1];
    const area = latest.parcelArea ?? contract.contractedArea;
    const share = latest.treeCover !== null && area ? (latest.treeCover / area) * 100 : null;
    $<HTMLElement>("#stat-tc-value").textContent = `${fmtNumber(latest.treeCover, 2)} ${t("unit.ha")}`;
    $<HTMLElement>("#stat-tc-note").textContent = t("analyses.inYear", { year: latest.year });
    $<HTMLElement>("#stat-share-value").textContent = share === null ? "–" : `${fmtNumber(share, 1)} %`;
    $<HTMLElement>("#stat-share-note").textContent = t("analyses.treeCoverShare");
    $<HTMLElement>("#stat-loss-value").textContent = `${fmtNumber(latest.loss, 2)} ${t("unit.ha")}`;
    $<HTMLElement>("#stat-loss-note").textContent = t("analyses.inYear", { year: latest.year });

    this.destroyCharts();
    const labels = rows.map((r) => String(r.year));
    this.charts.push(
      new Chart($<HTMLCanvasElement>("#chart-tc"), {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              data: rows.map((r) => r.treeCover),
              borderColor: COLOR_TREE_COVER,
              backgroundColor: COLOR_TREE_COVER,
              borderWidth: 2,
              pointRadius: 4,
              pointHoverRadius: 6,
              pointBorderColor: "#ffffff",
              pointBorderWidth: 1,
              tension: 0,
              spanGaps: true,
            },
          ],
        },
        options: chartOptions(t("unit.ha")),
      }),
    );
    this.charts.push(
      new Chart($<HTMLCanvasElement>("#chart-loss"), {
        type: "bar",
        data: {
          labels,
          datasets: [
            {
              data: rows.map((r) => r.loss),
              backgroundColor: COLOR_LOSS,
              borderRadius: 4,
              borderSkipped: "bottom",
              barPercentage: 0.55,
              categoryPercentage: 0.8,
            },
          ],
        },
        options: chartOptions(t("unit.ha")),
      }),
    );

    // table view (accessibility)
    const tbody = $<HTMLElement>("#an-table tbody");
    tbody.innerHTML = "";
    for (const r of rows) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${r.year}</td><td>${fmtNumber(r.treeCover, 2)}</td><td>${fmtNumber(r.loss, 2)}</td>`;
      tbody.appendChild(tr);
    }
  }

  private destroyCharts(): void {
    for (const c of this.charts) c.destroy();
    this.charts = [];
  }
}

function chartOptions(unit: string) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 250 },
    interaction: { mode: "index" as const, intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        displayColors: false,
        callbacks: {
          label: (ctx: { parsed: { y: number | null } }) => `${fmtNumber(ctx.parsed.y, 2)} ${unit}`,
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: INK_SECONDARY, font: { size: 11 } } },
      y: {
        beginAtZero: true,
        grid: { color: GRID },
        border: { display: false },
        ticks: { color: INK_SECONDARY, font: { size: 11 }, maxTicksLimit: 5 },
      },
    },
  };
}

function numberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function uniq(values: string[]): string[] {
  return [...new Set(values.filter((v) => v.trim().length > 0))].sort((a, b) => a.localeCompare(b));
}

function single(box: HTMLCalciteComboboxElement): string {
  const v = box.value;
  if (Array.isArray(v)) return v[0] ?? "";
  return v ? String(v) : "";
}
