import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { ApplicationList, FilterOptions } from "@cafi/shared";
import { api, type ApplicationFilters } from "../api/client";
import { fmtDate, fmtNum, useI18n, useT } from "../i18n";
import { Card, PageHeader, StatusBadge } from "./bits";

const EMPTY: ApplicationFilters = {};

export function ApplicationsPage() {
  const t = useT();
  const locale = useI18n((s) => s.locale);
  const [data, setData] = useState<ApplicationList | null>(null);
  const [options, setOptions] = useState<FilterOptions | null>(null);
  const [error, setError] = useState(false);
  const [filters, setFilters] = useState<ApplicationFilters>(EMPTY);

  const set = (patch: ApplicationFilters) =>
    setFilters((f) => {
      const next = { ...f, ...patch };
      // Changing country invalidates a province from another country.
      if ("country" in patch) next.province = undefined;
      return next;
    });

  useEffect(() => {
    api.filters(filters.country).then(setOptions).catch(() => setError(true));
  }, [filters.country]);

  useEffect(() => {
    const handle = setTimeout(() => {
      api
        .applications(filters)
        .then((d) => {
          setData(d);
          setError(false);
        })
        .catch(() => setError(true));
    }, 200); // debounce the search box
    return () => clearTimeout(handle);
  }, [filters]);

  const select = (
    value: string | undefined,
    key: keyof ApplicationFilters,
    all: string,
    values: string[],
  ) => (
    <select value={value ?? ""} onChange={(e) => set({ [key]: e.target.value || undefined })}>
      <option value="">{all}</option>
      {values.map((v) => (
        <option key={v}>{v}</option>
      ))}
    </select>
  );

  return (
    <main className="page">
      <PageHeader title={t("nav_applications")} desc={t("desc_applications")} />
      <div className="filters" role="search">
        <input
          type="search"
          value={filters.q ?? ""}
          onChange={(e) => set({ q: e.target.value || undefined })}
          placeholder={t("search_placeholder")}
          aria-label={t("search_placeholder")}
        />
        {select(filters.country, "country", t("all_countries"), options?.countries ?? [])}
        {select(filters.province, "province", t("all_provinces"), options?.provinces ?? [])}
        {select(filters.org, "org", t("all_organisations"), options?.organisations ?? [])}
        {select(filters.project, "project", t("all_projects"), options?.projects ?? [])}
        {select(filters.activity, "activity", t("all_activities"), options?.activities ?? [])}
        <select
          value={filters.status ?? ""}
          onChange={(e) => set({ status: e.target.value || undefined })}
        >
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
        <Card table>
        <table className="data">
          <thead>
            <tr>
              <th>{t("th_application")}</th>
              <th>{t("th_contract")}</th>
              <th>{t("th_activity")}</th>
              <th>{t("th_location")}</th>
              <th>{t("th_organisation")}</th>
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
                <td>
                  {[item.province, item.country].filter(Boolean).join(", ") || "—"}
                </td>
                <td>{item.implementingOrg ?? "—"}</td>
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
        </Card>
      )}
    </main>
  );
}
