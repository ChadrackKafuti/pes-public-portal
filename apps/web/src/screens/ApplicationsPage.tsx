import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import type { ApplicationList } from "@cafi/shared";
import { api } from "../api/client";
import { fmtDate, fmtNum, useI18n, useT } from "../i18n";
import { StatusBadge } from "./bits";

export function ApplicationsPage() {
  const t = useT();
  const locale = useI18n((s) => s.locale);
  const [data, setData] = useState<ApplicationList | null>(null);
  const [error, setError] = useState(false);
  const [q, setQ] = useState("");
  const [activity, setActivity] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    const handle = setTimeout(() => {
      api
        .applications({ q, activity, status })
        .then((d) => {
          setData(d);
          setError(false);
        })
        .catch(() => setError(true));
    }, 200); // debounce the search box
    return () => clearTimeout(handle);
  }, [q, activity, status]);

  const activities = useMemo(
    () => [...new Set((data?.items ?? []).map((i) => i.pesActivity).filter(Boolean))] as string[],
    [data],
  );

  return (
    <main className="page">
      <div className="filters" role="search">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("search_placeholder")}
          aria-label={t("search_placeholder")}
        />
        <select value={activity} onChange={(e) => setActivity(e.target.value)}>
          <option value="">{t("all_activities")}</option>
          {activities.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t("all_statuses")}</option>
          <option value="ok">ok</option>
          <option value="partial">partial</option>
          <option value="partial_final">partial_final</option>
        </select>
      </div>

      {error && <p className="notice">{t("error_load")}</p>}
      {!error && data === null && <p className="notice">{t("loading")}</p>}
      {data !== null && data.items.length === 0 && <p className="notice">{t("no_results")}</p>}

      {data !== null && data.items.length > 0 && (
        <table className="data">
          <thead>
            <tr>
              <th>{t("th_application")}</th>
              <th>{t("th_contract")}</th>
              <th>{t("th_activity")}</th>
              <th>{t("th_date")}</th>
              <th className="num">{t("th_area")}</th>
              <th className="num">{t("th_tree_cover")}</th>
              <th className="num">{t("th_visits")}</th>
              <th>{t("th_status")}</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((item) => (
              <tr key={item.applicationId}>
                <td>
                  <Link to={`/applications/${encodeURIComponent(item.applicationId)}`}>
                    {item.applicationCode ?? item.applicationId}
                  </Link>
                </td>
                <td>{item.contractCode ?? "—"}</td>
                <td>{item.pesActivity ?? "—"}</td>
                <td>{fmtDate(item.applicationDate, locale)}</td>
                <td className="num">{fmtNum(item.parcelAreaHa ?? item.estimatedAreaHa, locale)}</td>
                <td className="num">{fmtNum(item.treeCoverHa, locale)}</td>
                <td className="num">{item.visitCount}</td>
                <td>
                  <StatusBadge status={item.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
