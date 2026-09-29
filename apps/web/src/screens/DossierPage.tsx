import { useEffect, useState } from "react";
import { useParams } from "react-router";
import type { PesRsObject } from "@cafi/shared";
import { api } from "../api/client";
import { fmtDate, fmtNum, useI18n, useT } from "../i18n";
import { StatTile, StatusBadge } from "./bits";
import { TreeCoverChart } from "./TreeCoverChart";

function exportCsv(rows: PesRsObject[], name: string) {
  const columns = [
    "objectId", "objectType", "objectDate", "applicationCode", "contractCode",
    "pesActivity", "parcelAreaHa", "treeCoverHa", "defor5yrHaYr", "deforCurrentHa",
    "deforAlerts5yr", "deforAlertsCurrent", "fireAlerts5yr", "fireAlertsCurrent",
    "burnedArea5yrHa", "burnedAreaCurrentHa", "tcCoverage", "baselineYears", "status",
  ] as const;
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [
    columns.join(","),
    ...rows.map((r) => columns.map((c) => escape(r[c])).join(",")),
  ].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}-indicators.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function DossierPage() {
  const { id = "" } = useParams();
  const t = useT();
  const locale = useI18n((s) => s.locale);
  const [rows, setRows] = useState<PesRsObject[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api
      .applicationIndicators(id)
      .then((r) => setRows(r))
      .catch(() => setError(true));
  }, [id]);

  if (error) return <main className="page"><p className="notice">{t("error_load")}</p></main>;
  if (rows === null) return <main className="page"><p className="notice">{t("loading")}</p></main>;

  const application = rows.find((r) => r.objectType === "application");
  const latest = rows.at(-1);
  const latestVisit = [...rows].reverse().find((r) => r.objectType === "monitoring_visit");

  // Indicator table: baseline vs current, latest values per column. Units
  // differ per row, so this is a table, not a chart (one-axis rule).
  const indicators: Array<[string, number | null | undefined, number | null | undefined, number]> = [
    [t("ind_defor"), application?.defor5yrHaYr, latestVisit?.deforCurrentHa, 2],
    [t("ind_defor_alerts"), latest?.deforAlerts5yr, latestVisit?.deforAlertsCurrent, 0],
    [t("ind_fire_alerts"), latest?.fireAlerts5yr, latestVisit?.fireAlertsCurrent, 0],
    [t("ind_burned"), latest?.burnedArea5yrHa, latestVisit?.burnedAreaCurrentHa, 2],
  ];

  return (
    <main className="page">
      <h1 className="dossier-head">
        {t("dossier_title")} · {application?.applicationCode ?? id}
        {latest?.contractCode ? <span className="muted"> — {latest.contractCode}</span> : null}
        <span className="dossier-actions no-print">
          <button className="lang" onClick={() => exportCsv(rows, application?.applicationCode ?? id)}>
            {t("export_csv")}
          </button>
          <button className="lang" onClick={() => window.print()}>
            {t("export_pdf")}
          </button>
        </span>
      </h1>
      <p className="muted">
        {latest?.pesActivity ?? "—"}
        {application ? ` · ${fmtDate(application.objectDate, locale)}` : null}
        {latest ? <> · <StatusBadge status={latest.status} /></> : null}
      </p>

      <div className="stat-row">
        <StatTile
          label={t("kpi_parcel_area")}
          value={fmtNum(latest?.parcelAreaHa ?? null, locale)}
          unit="ha"
        />
        <StatTile
          label={t("kpi_tree_cover")}
          value={fmtNum((latestVisit ?? latest)?.treeCoverHa ?? null, locale)}
          unit="ha"
          hint={
            (latestVisit ?? latest)?.tcCoverage != null
              ? `coverage ${fmtNum(((latestVisit ?? latest)!.tcCoverage as number) * 100, locale, 0)}%`
              : undefined
          }
        />
        <StatTile
          label={t("kpi_defor_baseline")}
          value={fmtNum(application?.defor5yrHaYr ?? null, locale, 2)}
          unit={`ha${t("per_year")}`}
          hint={
            application?.baselineYears != null
              ? `${application.baselineYears} yr baseline`
              : undefined
          }
        />
        <StatTile
          label={t("kpi_defor_current")}
          value={fmtNum(latestVisit?.deforCurrentHa ?? null, locale, 2)}
          unit="ha"
          hint={latestVisit ? fmtDate(latestVisit.objectDate, locale) : undefined}
        />
      </div>

      <TreeCoverChart rows={rows} />

      <table className="data">
        <thead>
          <tr>
            <th>{t("tbl_indicator")}</th>
            <th className="num">{t("tbl_baseline")}</th>
            <th className="num">{t("tbl_current")}</th>
          </tr>
        </thead>
        <tbody>
          {indicators.map(([label, baseline, current, digits]) => (
            <tr key={label}>
              <td>{label}</td>
              <td className="num">{fmtNum(baseline ?? null, locale, digits)}</td>
              <td className="num">{fmtNum(current ?? null, locale, digits)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">{t("blank_hint")}</p>
    </main>
  );
}
