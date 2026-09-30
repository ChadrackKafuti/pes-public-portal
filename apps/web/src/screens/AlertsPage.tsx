import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { AlertRow, FilterOptions } from "@cafi/shared";
import { api } from "../api/client";
import { fmtDate, fmtNum, useI18n, useT } from "../i18n";

/** M4 — the alert feed: monitoring visits with an active disturbance
 *  signal, newest first. Signal chips use the reserved status hues with
 *  text labels, never color alone. */

function SignalChips({ row }: { row: AlertRow }) {
  const t = useT();
  const chips: { label: string; critical: boolean }[] = [];
  if ((row.deforAlertsCurrent ?? 0) > 0 || (row.deforCurrentHa ?? 0) > 0) {
    chips.push({ label: t("alert_defor"), critical: (row.deforCurrentHa ?? 0) >= 0.1 });
  }
  if ((row.fireAlertsCurrent ?? 0) > 0 || (row.burnedAreaCurrentHa ?? 0) > 0) {
    chips.push({ label: t("alert_fire"), critical: (row.burnedAreaCurrentHa ?? 0) >= 0.1 });
  }
  return (
    <span className="alert-chips">
      {chips.map((c) => (
        <span key={c.label} className={`alert-chip ${c.critical ? "alert-critical" : "alert-warning"}`}>
          {c.critical ? "▲" : "●"} {c.label}
        </span>
      ))}
    </span>
  );
}

export function AlertsPage() {
  const t = useT();
  const locale = useI18n((s) => s.locale);
  const [rows, setRows] = useState<AlertRow[] | null>(null);
  const [options, setOptions] = useState<FilterOptions | null>(null);
  const [country, setCountry] = useState<string | undefined>();
  const [error, setError] = useState(false);

  useEffect(() => {
    api.filters().then(setOptions).catch(() => undefined);
  }, []);
  useEffect(() => {
    api
      .alerts(country)
      .then((r) => {
        setRows(r);
        setError(false);
      })
      .catch(() => setError(true));
  }, [country]);

  if (error) return <main className="page"><p className="notice">{t("error_load")}</p></main>;
  if (rows === null) return <main className="page"><p className="notice">{t("loading")}</p></main>;

  return (
    <main className="page">
      <div className="filters">
        <select value={country ?? ""} onChange={(e) => setCountry(e.target.value || undefined)}>
          <option value="">{t("all_countries")}</option>
          {(options?.countries ?? []).map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>

      {rows.length === 0 ? (
        <p className="notice">{t("alerts_none")}</p>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>{t("th_date")}</th>
              <th>{t("th_application")}</th>
              <th>{t("th_location")}</th>
              <th>{t("alert_signals")}</th>
              <th className="num">{t("alert_defor_alerts")}</th>
              <th className="num">{t("alert_fire_alerts")}</th>
              <th className="num">{t("alert_loss")}</th>
              <th className="num">{t("alert_burned")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.objectId}>
                <td>{fmtDate(r.objectDate, locale)}</td>
                <td>
                  <Link to={`/applications/${encodeURIComponent(r.applicationId)}`}>
                    {r.applicationCode ?? r.applicationId}
                  </Link>
                </td>
                <td>{[r.province, r.country].filter(Boolean).join(", ") || "—"}</td>
                <td><SignalChips row={r} /></td>
                <td className="num">{fmtNum(r.deforAlertsCurrent, locale, 0)}</td>
                <td className="num">{fmtNum(r.fireAlertsCurrent, locale, 0)}</td>
                <td className="num">{fmtNum(r.deforCurrentHa, locale, 2)}</td>
                <td className="num">{fmtNum(r.burnedAreaCurrentHa, locale, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted small">{t("alerts_hint")}</p>
    </main>
  );
}
