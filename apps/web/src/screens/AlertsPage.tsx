import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import type { AlertRow, FilterOptions, IncidentItem, Incidents } from "@cafi/shared";
import { api } from "../api/client";
import { fmtDate, fmtNum, useI18n, useT, type Key } from "../i18n";
import { Card, PageHeader } from "./bits";

/** M23 — incident statuses, their labels and the actions each allows. */
const INC_STATUS_KEY: Record<string, Key> = {
  open: "inc_open",
  responded: "inc_responded",
  verified: "inc_verified",
  dismissed: "inc_dismissed",
  resolved: "inc_resolved",
};
const INC_ACTIONS: Record<string, string[]> = {
  open: ["responded", "verified", "dismissed"],
  responded: ["verified", "dismissed", "open"],
  verified: ["open"],
  dismissed: ["open"],
  resolved: ["open"],
};
const INC_STATUS_ORDER = ["open", "responded", "verified", "dismissed", "resolved"];

function IncidentFeed({ country }: { country?: string }) {
  const t = useT();
  const locale = useI18n((s) => s.locale);
  const [data, setData] = useState<Incidents | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(() => {
    api
      .incidents({ status: status || undefined, country })
      .then((d) => {
        setData(d);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, [status, country]);
  useEffect(reload, [reload]);

  const act = (i: IncidentItem, target: string) => {
    setBusy(i.incidentUid);
    api
      .incidentUpdate(i.incidentUid, target)
      .then(reload)
      .catch(() => setFailed(true))
      .finally(() => setBusy(null));
  };

  if (failed) return <p className="notice">{t("error_load")}</p>;
  if (data === null) return <p className="notice">{t("loading")}</p>;

  return (
    <>
      <div className="adm-summary">
        <button
          className={`adm-chip${status === "" ? " adm-chip-on" : ""}`}
          onClick={() => setStatus("")}
        >
          {t("inc_all")} ·{" "}
          {fmtNum(Object.values(data.summary).reduce((s, n) => s + n, 0), locale, 0)}
        </button>
        {INC_STATUS_ORDER.map((s) => (
          <button
            key={s}
            className={`adm-chip${status === s ? " adm-chip-on" : ""}`}
            onClick={() => setStatus(status === s ? "" : s)}
          >
            {t(INC_STATUS_KEY[s])} · {fmtNum(data.summary[s] ?? 0, locale, 0)}
          </button>
        ))}
      </div>
      {data.items.length === 0 ? (
        <p className="notice">{t("inc_none")}</p>
      ) : (
        <Card table>
          <table className="data">
            <thead>
              <tr>
                <th>{t("inc_th_kind")}</th>
                <th>{t("th_application")}</th>
                <th>{t("th_location")}</th>
                <th>{t("inc_th_window")}</th>
                <th className="num">{t("inc_th_magnitude")}</th>
                <th>{t("inc_th_status")}</th>
                <th>{t("inc_th_actions")}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((i) => (
                <tr key={i.incidentUid}>
                  <td>
                    <span
                      className={`alert-chip ${
                        i.kind === "fire" ? "alert-critical" : "alert-warning"
                      }`}
                    >
                      {i.kind === "fire" ? "▲" : "●"}{" "}
                      {i.kind === "fire" ? t("alert_fire") : t("alert_defor")}
                    </span>
                  </td>
                  <td>
                    <Link to={`/applications/${encodeURIComponent(i.applicationId)}`}>
                      {i.applicationCode ?? i.applicationId}
                    </Link>
                    {i.implementingOrg && (
                      <span className="muted small"> · {i.implementingOrg}</span>
                    )}
                  </td>
                  <td>{[i.province, i.country].filter(Boolean).join(", ") || "—"}</td>
                  <td>
                    {fmtDate(i.firstDetected, locale)} → {fmtDate(i.lastDetected, locale)}
                  </td>
                  <td className="num">{fmtNum(i.magnitude, locale, 0)}</td>
                  <td>
                    <span className={`inc-status inc-${i.status}`}>
                      {INC_STATUS_KEY[i.status] ? t(INC_STATUS_KEY[i.status]) : i.status}
                    </span>
                    {i.statusBy && <span className="muted small"> · {i.statusBy}</span>}
                  </td>
                  <td className="inc-actions">
                    {(INC_ACTIONS[i.status] ?? []).map((target) => (
                      <button
                        key={target}
                        disabled={busy === i.incidentUid}
                        onClick={() => act(i, target)}
                      >
                        {t(INC_STATUS_KEY[target])}
                      </button>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <p className="muted small">{t("inc_hint")}</p>
    </>
  );
}

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
      <PageHeader title={t("nav_alerts")} desc={t("desc_alerts")} />
      <div className="filters">
        <select value={country ?? ""} onChange={(e) => setCountry(e.target.value || undefined)}>
          <option value="">{t("all_countries")}</option>
          {(options?.countries ?? []).map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>

      <h3 className="inc-heading">{t("inc_title")}</h3>
      <IncidentFeed country={country} />

      <h3 className="inc-heading">{t("inc_visit_signals")}</h3>
      {rows.length === 0 ? (
        <p className="notice">{t("alerts_none")}</p>
      ) : (
        <Card table>
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
        </Card>
      )}
      <p className="muted small">{t("alerts_hint")}</p>
    </main>
  );
}
