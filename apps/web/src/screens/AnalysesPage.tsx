import { useEffect, useMemo, useState } from "react";
import type { AnalysesContract, ContractAnalysis } from "@cafi/shared";
import { api } from "../api/client";
import { fmtDate, fmtNum, useI18n, useT } from "../i18n";
import { StatTile } from "./bits";

/** M7d — the v1 contract-analysis page: Org → Project → Contract pickers,
 *  the generated description sentence, three KPIs for the latest year, the
 *  annual tree-cover line and loss bars, a data table, and the Dynamic
 *  World citation. */

const W = 640;
const H = 170;
const PAD = { top: 14, right: 16, bottom: 24, left: 44 };

function px(i: number, n: number) {
  return PAD.left + (n > 1 ? (i / (n - 1)) * (W - PAD.left - PAD.right) : 0);
}

function AnnualLine({ title, points }: { title: string; points: [number, number][] }) {
  const locale = useI18n((s) => s.locale);
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return null;
  const yMax = Math.max(...points.map(([, v]) => v)) * 1.2 || 1;
  const py = (v: number) => H - PAD.bottom - (v / yMax) * (H - PAD.top - PAD.bottom);
  const path = points
    .map(([, v], i) => `${i === 0 ? "M" : "L"}${px(i, points.length)},${py(v)}`)
    .join(" ");
  return (
    <figure className="chart">
      <figcaption>{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        {[0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PAD.left} x2={W - PAD.right} y1={py(yMax * f)} y2={py(yMax * f)} stroke="var(--grid)" />
            <text x={PAD.left - 6} y={py(yMax * f) + 4} textAnchor="end" className="axis-text">
              {fmtNum(yMax * f, locale, 1)}
            </text>
          </g>
        ))}
        <line x1={PAD.left} x2={W - PAD.right} y1={py(0)} y2={py(0)} stroke="var(--axis)" />
        <path d={path} fill="none" stroke="var(--series-1)" strokeWidth="2" />
        {points.map(([year, v], i) => (
          <g key={year}>
            <circle cx={px(i, points.length)} cy={py(v)} r="6" fill="var(--bg)" />
            <circle cx={px(i, points.length)} cy={py(v)} r="4" fill="var(--series-1)" />
            <circle
              cx={px(i, points.length)} cy={py(v)} r="12" fill="transparent"
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
            />
            <text x={px(i, points.length)} y={H - PAD.bottom + 14} textAnchor="middle" className="axis-text">
              {year}
            </text>
          </g>
        ))}
        {hover !== null && (() => {
          const [year, v] = points[hover];
          const label = `${year} · ${fmtNum(v, locale, 2)} ha`;
          const bw = label.length * 6.6 + 16;
          const bx = Math.min(Math.max(px(hover, points.length) - bw / 2, PAD.left), W - PAD.right - bw);
          return (
            <g pointerEvents="none">
              <rect x={bx} y={py(v) - 32} width={bw} height="22" rx="4" className="tooltip-box" />
              <text x={bx + bw / 2} y={py(v) - 17} textAnchor="middle" className="tooltip-text">{label}</text>
            </g>
          );
        })()}
      </svg>
    </figure>
  );
}

function AnnualBars({ title, points }: { title: string; points: [number, number][] }) {
  const locale = useI18n((s) => s.locale);
  const [hover, setHover] = useState<number | null>(null);
  if (!points.length) return null;
  const yMax = Math.max(...points.map(([, v]) => v)) * 1.2 || 1;
  const py = (v: number) => H - PAD.bottom - (v / yMax) * (H - PAD.top - PAD.bottom);
  const bw = Math.min(34, ((W - PAD.left - PAD.right) / points.length) * 0.6);
  return (
    <figure className="chart">
      <figcaption>{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        <line x1={PAD.left} x2={W - PAD.right} y1={py(0)} y2={py(0)} stroke="var(--axis)" />
        {points.map(([year, v], i) => (
          <g key={year} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <rect
              x={px(i, points.length) - bw / 2} y={py(v)} width={bw}
              height={Math.max(1, py(0) - py(v))} rx="3" fill="var(--series-2, var(--series-1))"
            />
            <text x={px(i, points.length)} y={H - PAD.bottom + 14} textAnchor="middle" className="axis-text">
              {year}
            </text>
            {hover === i && (
              <text x={px(i, points.length)} y={py(v) - 6} textAnchor="middle" className="tooltip-text">
                {fmtNum(v, locale, 2)}
              </text>
            )}
          </g>
        ))}
      </svg>
    </figure>
  );
}

export function AnalysesPage() {
  const t = useT();
  const locale = useI18n((s) => s.locale);
  const [contracts, setContracts] = useState<AnalysesContract[] | null>(null);
  const [org, setOrg] = useState("");
  const [project, setProject] = useState("");
  const [code, setCode] = useState("");
  const [analysis, setAnalysis] = useState<ContractAnalysis | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.analysesContracts().then(setContracts).catch(() => setError(true));
  }, []);

  useEffect(() => {
    if (!code) {
      setAnalysis(null);
      return;
    }
    api.contractAnalysis(code).then(setAnalysis).catch(() => setError(true));
  }, [code]);

  const orgs = useMemo(
    () => [...new Set((contracts ?? []).map((c) => c.org).filter(Boolean))] as string[],
    [contracts],
  );
  const inOrg = (contracts ?? []).filter((c) => !org || c.org === org);
  const projects = [...new Set(inOrg.map((c) => c.project).filter(Boolean))] as string[];
  const inProject = inOrg.filter((c) => !project || c.project === project);

  const latest = analysis?.series.at(-1);
  const baseArea = analysis?.parcelAreaHa ?? analysis?.contractedAreaHa ?? null;
  const share =
    latest?.tcHa != null && baseArea ? Math.min(100, (latest.tcHa / baseArea) * 100) : null;

  /* v1 pattern: a glass side panel floating over the live map stage. */
  return (
    <div className="an-overlay">
      <div className="glass panel an-panel">
        <div className="panel-body scroll">
          <h2 className="an-heading">{t("an_title")}</h2>
          {error && <p className="panel-hint">{t("error_load")}</p>}
          {!error && (
            <>
      <div className="an-pickers">
        <select value={org} onChange={(e) => { setOrg(e.target.value); setProject(""); setCode(""); }}>
          <option value="">{t("all_organisations")}</option>
          {orgs.map((o) => <option key={o}>{o}</option>)}
        </select>
        <select value={project} onChange={(e) => { setProject(e.target.value); setCode(""); }}>
          <option value="">{t("all_projects")}</option>
          {projects.map((p) => <option key={p}>{p}</option>)}
        </select>
        <select value={code} onChange={(e) => setCode(e.target.value)}>
          <option value="">{t("an_pick_contract")}</option>
          {inProject.map((c) => (
            <option key={c.contractCode} value={c.contractCode}>
              {c.contractCode}
              {c.org ? ` · ${c.org}` : ""}
              {c.village ? ` · ${c.village}` : ""}
              {c.country ? ` · ${c.country}` : ""}
            </option>
          ))}
        </select>
      </div>

      {contracts === null && <p className="panel-hint">{t("loading")}</p>}
      {contracts !== null && !code && <p className="panel-hint">{t("an_select_hint")}</p>}

      {analysis && (
        <>
            <p className="an-desc">
              {t("an_desc", {
                code: analysis.contractCode,
                beneficiary: analysis.beneficiaryType ?? "—",
                village: analysis.village ?? "—",
                country: analysis.country ?? "—",
                area: fmtNum(analysis.contractedAreaHa ?? analysis.parcelAreaHa, locale),
                activity: analysis.activity ?? "—",
                org: analysis.org ?? "—",
                start: analysis.startDate ? fmtDate(analysis.startDate, locale) : "—",
                end: analysis.endDate ? fmtDate(analysis.endDate, locale) : "—",
              })}
            </p>

          {analysis.series.length === 0 ? (
            <p className="panel-hint">{t("an_none")}</p>
          ) : (
            <>
              <div className="an-tiles">
                <StatTile
                  label={t("an_kpi_tc")}
                  value={fmtNum(latest?.tcHa ?? null, locale)}
                  unit="ha"
                  hint={latest ? t("an_in_year", { year: latest.year }) : undefined}
                />
                <StatTile
                  label={t("an_kpi_share")}
                  value={fmtNum(share, locale, 1)}
                  unit="%"
                  hint={t("an_of_area")}
                />
                <StatTile
                  label={t("an_kpi_loss")}
                  value={fmtNum(latest?.lossHa ?? null, locale, 2)}
                  unit="ha"
                  hint={latest ? t("an_in_year", { year: latest.year }) : undefined}
                />
              </div>

              <AnnualLine
                title={t("an_chart_tc")}
                points={analysis.series.filter((p) => p.tcHa != null).map((p) => [p.year, p.tcHa!])}
              />
              <AnnualBars
                title={t("an_chart_loss")}
                points={analysis.series.filter((p) => p.lossHa != null).map((p) => [p.year, p.lossHa!])}
              />

              <details className="an-table">
                <summary>{t("an_table")}</summary>
                <table className="data">
                  <thead>
                    <tr>
                      <th>{t("an_th_year")}</th>
                      <th className="num">{t("an_kpi_tc")} (ha)</th>
                      <th className="num">{t("an_kpi_loss")} (ha)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.series.map((p) => (
                      <tr key={p.year}>
                        <td>{p.year}</td>
                        <td className="num">{fmtNum(p.tcHa, locale, 2)}</td>
                        <td className="num">{fmtNum(p.lossHa, locale, 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </>
          )}

          <p className="an-source">
            Source: Brown, C.F. et al. Dynamic World, near real-time global 10 m land use land
            cover mapping. Sci Data 9, 251 (2022).
          </p>
        </>
      )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
