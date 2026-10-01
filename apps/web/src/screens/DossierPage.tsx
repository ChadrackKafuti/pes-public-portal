import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import type { PesRsObject, Photo } from "@cafi/shared";
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

/** M7a — geotagged photo strip: signed thumbnails, click for full size. */
function PhotoGallery({ applicationId }: { applicationId: string }) {
  const t = useT();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [openUid, setOpenUid] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .applicationPhotos(applicationId)
      .then((rows) => {
        if (cancelled) return;
        setPhotos(rows);
        rows
          .filter((p) => p.mirrored)
          .slice(0, 24)
          .forEach((p) => {
            api
              .photoImageUrl(p.photoUid)
              .then(({ url }) => setUrls((u) => ({ ...u, [p.photoUid]: url })))
              .catch(() => undefined);
          });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [applicationId]);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (openUid && !d.open) d.showModal();
    if (!openUid && d.open) d.close();
  }, [openUid]);

  if (photos.length === 0) return null;
  const open = openUid ? photos.find((p) => p.photoUid === openUid) : null;
  return (
    <section className="photo-section">
      <h2 className="photo-head">{t("dossier_photos")}</h2>
      <div className="photo-grid">
        {photos.map((p) => (
          <figure className="photo-card" key={p.photoUid}>
            {urls[p.photoUid] ? (
              <button className="photo-thumb" onClick={() => setOpenUid(p.photoUid)}>
                <img src={urls[p.photoUid]} alt={p.label ?? "Photo"} loading="lazy" />
              </button>
            ) : (
              <span className="photo-thumb photo-missing muted small">{t("photo_pending")}</span>
            )}
            <figcaption className="muted small">
              {p.label ?? "Photo"}
              {p.kind === "monitoring_visit" && p.parentId ? ` · ${p.parentId}` : ""}
            </figcaption>
          </figure>
        ))}
      </div>
      <dialog ref={dialogRef} className="photo-dialog" onClose={() => setOpenUid(null)}>
        {open && urls[open.photoUid] && (
          <>
            <img src={urls[open.photoUid]} alt={open.label ?? "Photo"} />
            <p className="muted small">
              {open.label ?? "Photo"} · {open.lat.toFixed(6)}, {open.lon.toFixed(6)}
            </p>
            <button className="btn-ghost" onClick={() => setOpenUid(null)}>
              {t("photo_close")}
            </button>
          </>
        )}
      </dialog>
    </section>
  );
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

      <PhotoGallery applicationId={id} />

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
