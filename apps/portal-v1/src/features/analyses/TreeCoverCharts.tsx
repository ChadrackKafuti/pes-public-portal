import { useMemo } from "react";
import { Chart, BarController, BarElement, LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip } from "chart.js";
import { Bar, Line } from "react-chartjs-2";
import { useLang, useT } from "@/i18n";
import { fmtNumber } from "@/i18n/format";
import { chart as chartTokens, mapUi } from "@/theme/tokens";
import type { YearRow } from "@/services/analysis";
import s from "./AnalysesPage.module.css";

Chart.register(BarController, BarElement, LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip);

function options(unit: string) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 250 },
    interaction: { mode: "index" as const, intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        displayColors: false,
        callbacks: { label: (ctx: { parsed: { y: number | null } }) => `${fmtNumber(ctx.parsed.y, 2)} ${unit}` },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: mapUi.textMuted, font: { size: 11 } } },
      y: {
        beginAtZero: true,
        grid: { color: chartTokens.gridDark },
        border: { display: false },
        ticks: { color: mapUi.textMuted, font: { size: 11 }, maxTicksLimit: 5 },
      },
    },
  };
}

/** Two single-series charts (tree cover line, loss bars) plus the accessible table. */
export function TreeCoverCharts({ rows }: { rows: YearRow[] }) {
  const t = useT();
  const lang = useLang();
  const labels = useMemo(() => rows.map((r) => String(r.year)), [rows]);
  const unit = t("unit.ha");
  const opts = useMemo(() => options(unit), [unit]);

  const cover = useMemo(
    () => ({
      labels,
      datasets: [
        {
          data: rows.map((r) => r.treeCover),
          borderColor: chartTokens.treeCover,
          backgroundColor: chartTokens.treeCover,
          borderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBorderColor: "#ffffff",
          pointBorderWidth: 1,
          tension: 0,
          spanGaps: true,
        },
      ],
    }),
    [labels, rows],
  );
  const loss = useMemo(
    () => ({
      labels,
      datasets: [
        {
          data: rows.map((r) => r.loss),
          backgroundColor: chartTokens.loss,
          borderRadius: 4,
          borderSkipped: "bottom" as const,
          barPercentage: 0.55,
          categoryPercentage: 0.8,
        },
      ],
    }),
    [labels, rows],
  );

  return (
    <>
      <figure className={s.figure}>
        <figcaption>{t("analyses.chartTreeCover")}</figcaption>
        <div className={s.chart}>
          <Line key={`c-${lang}`} data={cover} options={opts} aria-label={t("analyses.chartTreeCover")} />
        </div>
      </figure>
      <figure className={s.figure}>
        <figcaption>{t("analyses.chartLoss")}</figcaption>
        <div className={s.chart}>
          <Bar key={`l-${lang}`} data={loss} options={opts} aria-label={t("analyses.chartLoss")} />
        </div>
      </figure>
      <details className={s.details}>
        <summary>{t("analyses.table")}</summary>
        <table className={s.table}>
          <thead>
            <tr>
              <th scope="col">{t("analyses.year")}</th>
              <th scope="col">
                {t("analyses.treeCover")} ({unit})
              </th>
              <th scope="col">
                {t("analyses.treeCoverLoss")} ({unit})
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.year}>
                <td>{r.year}</td>
                <td>{fmtNumber(r.treeCover, 2)}</td>
                <td>{fmtNumber(r.loss, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}
