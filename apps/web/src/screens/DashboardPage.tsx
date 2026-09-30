import { useEffect, useState } from "react";
import type { Dashboard, DashboardGroup, FilterOptions } from "@cafi/shared";
import { api } from "../api/client";
import { fmtNum, useI18n, useT } from "../i18n";
import { GOV_LAYER_ORDER, govLayerLabel } from "../map/governance";
import { StatTile, StatusBadge } from "./bits";

/**
 * M5 — jurisdictional dashboard. One payload, four blocks: KPI tiles,
 * per-dimension bar lists (magnitude by category → horizontal bars, one
 * hue, values always visible so no tooltip layer is needed), the monthly
 * application line, and the governance inventory.
 */

function BarList({
  title,
  rows,
  unitHint,
}: {
  title: string;
  rows: { label: string; value: number; hint?: string }[];
  unitHint?: string;
}) {
  const locale = useI18n((s) => s.locale);
  if (!rows.length) return null;
  const max = Math.max(...rows.map((r) => r.value)) || 1;
  return (
    <figure className="chart barlist">
      <figcaption>{title}</figcaption>
      {rows.map((r) => (
        <div className="barlist-row" key={r.label}>
          <span className="barlist-label" title={r.label}>{r.label}</span>
          <span className="barlist-track">
            <span className="barlist-bar" style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="barlist-value">
            {fmtNum(r.value, locale, 0)}
            {r.hint ? <span className="muted small"> · {r.hint}</span> : null}
          </span>
        </div>
      ))}
      {unitHint ? <p className="muted small">{unitHint}</p> : null}
    </figure>
  );
}

const MW = 640;
const MH = 160;
const MPAD = { top: 14, right: 16, bottom: 24, left: 40 };

function MonthlyChart({ months }: { months: { month: string; applications: number }[] }) {
  const t = useT();
  const locale = useI18n((s) => s.locale);
  const [hover, setHover] = useState<number | null>(null);
  if (months.length < 2) return null;
  const yMax = Math.max(...months.map((m) => m.applications)) * 1.2 || 1;
  const px = (i: number) =>
    MPAD.left + (i / (months.length - 1)) * (MW - MPAD.left - MPAD.right);
  const py = (v: number) => MH - MPAD.bottom - (v / yMax) * (MH - MPAD.top - MPAD.bottom);
  const path = months.map((m, i) => `${i === 0 ? "M" : "L"}${px(i)},${py(m.applications)}`).join(" ");
  const gridYs = [0.5, 1].map((f) => yMax * f);
  const tickEvery = Math.ceil(months.length / 8);
  return (
    <figure className="chart">
      <figcaption>{t("dash_by_month")}</figcaption>
      <svg viewBox={`0 0 ${MW} ${MH}`} role="img" aria-label={t("dash_by_month")}>
        {gridYs.map((g) => (
          <g key={g}>
            <line x1={MPAD.left} x2={MW - MPAD.right} y1={py(g)} y2={py(g)} stroke="var(--grid)" strokeWidth="1" />
            <text x={MPAD.left - 6} y={py(g) + 4} textAnchor="end" className="axis-text">
              {fmtNum(g, locale, 0)}
            </text>
          </g>
        ))}
        <line x1={MPAD.left} x2={MW - MPAD.right} y1={py(0)} y2={py(0)} stroke="var(--axis)" strokeWidth="1" />
        <path d={path} fill="none" stroke="var(--series-1)" strokeWidth="2" />
        {months.map((m, i) => (
          <g key={m.month}>
            <circle cx={px(i)} cy={py(m.applications)} r="6" fill="var(--bg)" />
            <circle cx={px(i)} cy={py(m.applications)} r="4" fill="var(--series-1)" />
            <circle
              cx={px(i)} cy={py(m.applications)} r="12" fill="transparent"
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
            />
            {i % tickEvery === 0 && (
              <text
                x={px(i)} y={MH - MPAD.bottom + 14}
                textAnchor={i === 0 ? "start" : i === months.length - 1 ? "end" : "middle"}
                className="axis-text"
              >
                {m.month}
              </text>
            )}
          </g>
        ))}
        {hover !== null && (() => {
          const m = months[hover];
          const label = `${m.month} · ${m.applications}`;
          const boxW = label.length * 6.6 + 16;
          const bx = Math.min(Math.max(px(hover) - boxW / 2, MPAD.left), MW - MPAD.right - boxW);
          return (
            <g pointerEvents="none">
              <rect x={bx} y={py(m.applications) - 32} width={boxW} height="22" rx="4" className="tooltip-box" />
              <text x={bx + boxW / 2} y={py(m.applications) - 17} textAnchor="middle" className="tooltip-text">
                {label}
              </text>
            </g>
          );
        })()}
      </svg>
    </figure>
  );
}

export function DashboardPage() {
  const t = useT();
  const { locale } = useI18n();
  const [data, setData] = useState<Dashboard | null>(null);
  const [options, setOptions] = useState<FilterOptions | null>(null);
  const [country, setCountry] = useState<string | undefined>();
  const [error, setError] = useState(false);

  useEffect(() => {
    api.filters().then(setOptions).catch(() => undefined);
  }, []);
  useEffect(() => {
    api
      .dashboard(country)
      .then((d) => {
        setData(d);
        setError(false);
      })
      .catch(() => setError(true));
  }, [country]);

  if (error) return <main className="page"><p className="notice">{t("error_load")}</p></main>;
  if (data === null) return <main className="page"><p className="notice">{t("loading")}</p></main>;

  const { pes, governance } = data;
  const asGroupRows = (groups: DashboardGroup[]) =>
    groups.map((g) => ({
      label: g.name,
      value: g.applications,
      hint: g.areaHa != null ? `${fmtNum(g.areaHa, locale, 0)} ha` : undefined,
    }));

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

      <div className="stat-row">
        <StatTile label={t("dash_applications")} value={fmtNum(pes.applications, locale, 0)} />
        <StatTile label={t("dash_area")} value={fmtNum(pes.parcelAreaHa, locale)} unit="ha" />
        <StatTile label={t("dash_tree_cover")} value={fmtNum(pes.treeCoverHa, locale)} unit="ha" />
        <StatTile label={t("dash_visits")} value={fmtNum(pes.visits, locale, 0)} />
      </div>

      <p className="status-row">
        <span className="muted small">{t("dash_processing")}:</span>{" "}
        <StatusBadge status="ok" /> {pes.statusCounts.ok} ·{" "}
        <StatusBadge status="partial" /> {pes.statusCounts.partial} ·{" "}
        <StatusBadge status="partial_final" /> {pes.statusCounts.partialFinal}
      </p>

      <MonthlyChart months={pes.byMonth} />

      <div className="chart-grid">
        <BarList title={t("dash_by_country")} rows={asGroupRows(pes.byCountry)} />
        <BarList title={t("dash_by_activity")} rows={asGroupRows(pes.byActivity)} />
      </div>

      <BarList
        title={t("dash_governance")}
        rows={governance.byLayer
          .filter((l) => l.count > 0)
          .map((l) => ({
            label: govLayerLabel(l.layer, locale),
            value: l.count,
            hint: l.areaHa != null ? `${fmtNum(l.areaHa, locale, 0)} ha` : undefined,
          }))}
        unitHint={`${t("dash_documents")}: ${fmtNum(governance.documents, locale, 0)}`}
      />
    </main>
  );
}
