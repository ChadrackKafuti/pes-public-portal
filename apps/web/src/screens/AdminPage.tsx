import { useEffect, useState } from "react";
import type { AdminExceptions } from "@cafi/shared";
import { api } from "../api/client";
import { fmtDate, fmtNum, useI18n, useT, type Key } from "../i18n";
import { Card, PageHeader } from "./bits";

/** M20 — admin follow-up: every parcel the pipeline skipped or failed
 *  (oversize, unusable geometry, computation failures), grouped per object,
 *  so the source data can be chased. */

const REASON_KEYS: Record<string, Key> = {
  oversize_gt_5000ha: "adm_oversize",
  no_usable_geometry: "adm_geometry",
  own_failed: "adm_compute_failed",
  annual_failed: "adm_annual_failed",
  landcover_failed: "adm_landcover_failed",
  nrt_failed: "adm_compute_failed",
  bad_record: "adm_bad_record",
  bad_object_date: "adm_bad_record",
  parent_failed: "adm_bad_record",
};

export function AdminPage() {
  const t = useT();
  const locale = useI18n((s) => s.locale);
  const [data, setData] = useState<AdminExceptions | null>(null);
  const [error, setError] = useState(false);
  const [reason, setReason] = useState("");

  useEffect(() => {
    api.adminExceptions().then(setData).catch(() => setError(true));
  }, []);

  if (error) return <main className="page"><p className="notice">{t("error_load")}</p></main>;
  if (data === null) return <main className="page"><p className="notice">{t("loading")}</p></main>;

  const reasonLabel = (r: string) => (REASON_KEYS[r] ? t(REASON_KEYS[r]) : r);
  const items = reason ? data.items.filter((i) => i.reason === reason) : data.items;

  return (
    <main className="page">
      <PageHeader title={t("adm_title")} desc={t("adm_lead")} />
      <div className="adm-summary">
        <button
          className={`adm-chip${reason === "" ? " adm-chip-on" : ""}`}
          onClick={() => setReason("")}
        >
          {t("adm_all")} · {fmtNum(data.summary.reduce((s, x) => s + x.objects, 0), locale, 0)}
        </button>
        {data.summary.map((s) => (
          <button
            key={s.reason}
            className={`adm-chip${reason === s.reason ? " adm-chip-on" : ""}`}
            onClick={() => setReason(reason === s.reason ? "" : s.reason)}
          >
            {reasonLabel(s.reason)} · {fmtNum(s.objects, locale, 0)}
          </button>
        ))}
      </div>
      <Card>
        {items.length === 0 ? (
          <p className="notice">{t("adm_none")}</p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>{t("adm_th_object")}</th>
                <th>{t("adm_th_type")}</th>
                <th>{t("adm_th_reason")}</th>
                <th className="num">{t("adm_th_area")}</th>
                <th className="num">{t("adm_th_occurrences")}</th>
                <th>{t("adm_th_last_seen")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={`${i.objectId}-${i.reason}`}>
                  <td>
                    {i.applicationCode ?? i.objectId}
                    {i.implementingOrg && (
                      <span className="muted small"> · {i.implementingOrg}</span>
                    )}
                  </td>
                  <td>
                    {i.objectType === "monitoring_visit"
                      ? t("adm_type_visit")
                      : t("adm_type_application")}
                  </td>
                  <td>{reasonLabel(i.reason)}</td>
                  <td className="num">
                    {i.areaGis != null ? `${fmtNum(i.areaGis, locale, 0)} ha` : "—"}
                  </td>
                  <td className="num">{fmtNum(i.occurrences, locale, 0)}</td>
                  <td>{i.lastSeen ? fmtDate(i.lastSeen, locale) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <p className="muted small">{t("adm_hint")}</p>
    </main>
  );
}
