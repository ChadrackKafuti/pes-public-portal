import type { Profile } from "@cafi/shared";
import { fmtDate, fmtNum, useI18n, useT, type Key } from "../i18n";

/** M7b — the v1 popup blocks, rebuilt: chips, stage tracker, contract
 *  timeline, visit tracker, fire card, performance donut, area bars and
 *  the attribute sections. Status hues always ship with a text label. */

const GOOD = "var(--status-good)";
const WARN = "var(--status-warning)";
const CRIT = "var(--status-critical)";

export function ChipsRow({ p }: { p: Profile }) {
  const t = useT();
  const chips: { text: string; color?: string }[] = [];
  if (p.stage?.name) chips.push({ text: `${t("pf_stage")}: ${p.stage.name}` });
  if (p.contract?.status) {
    chips.push({
      text: `${t("pf_contract")}: ${p.contract.status}`,
      color: /active|actif/i.test(p.contract.status) ? GOOD : undefined,
    });
  }
  if (p.visits?.overdue) chips.push({ text: t("pf_visit_overdue"), color: WARN });
  if (p.fire?.category === "high" || p.fire?.category === "very_high") {
    chips.push({ text: `${t("pf_fire_risk")}: ${t(`fire_${p.fire.category}` as Key)}`, color: CRIT });
  }
  if (!chips.length) return null;
  return (
    <p className="chip-row">
      {chips.map((c) => (
        <span key={c.text} className="alert-chip" style={c.color ? { color: c.color } : undefined}>
          {c.color ? "● " : ""}
          {c.text}
        </span>
      ))}
    </p>
  );
}

export function StageTracker({ p }: { p: Profile }) {
  const t = useT();
  const s = p.stage;
  if (!s || s.order == null) return null;
  const n = Math.min(s.order, s.total);
  if (s.category === "rejected") {
    return (
      <div className="stage-track">
        <div className="stage-bar stage-rejected" />
        <span className="muted small">
          {s.name ?? s.status} — {t("pf_stage_stopped", { n, total: s.total })}
        </span>
      </div>
    );
  }
  if (s.category === "archived") {
    return (
      <div className="stage-track">
        <div className="stage-bar stage-archived" />
        <span className="muted small">{t("pf_archived")}</span>
      </div>
    );
  }
  return (
    <div className="stage-track">
      <div className="stage-segments" role="img" aria-label={t("pf_stage_caption", { n, total: s.total, name: s.name ?? "" })}>
        {Array.from({ length: s.total }, (_, i) => (
          <span key={i} className={`stage-seg${i < n ? " on" : ""}`} />
        ))}
      </div>
      <span className="muted small">{t("pf_stage_caption", { n, total: s.total, name: s.name ?? "" })}</span>
    </div>
  );
}

export function Breadcrumb({ p }: { p: Profile }) {
  const parts = [p.location.country, p.location.province, p.location.territory, p.location.village].filter(Boolean);
  if (!parts.length) return null;
  return <p className="muted small">📍 {parts.join(" › ")}</p>;
}

export function ContractTimeline({ p }: { p: Profile }) {
  const t = useT();
  const locale = useI18n((s) => s.locale);
  const c = p.contract;
  if (!c || !c.start || !c.end || c.pctElapsed == null) return null;
  const color = c.pctElapsed >= 100 ? CRIT : c.pctElapsed > 75 ? WARN : GOOD;
  return (
    <div className="tl-card">
      <div className="tl-row">
        <span className="small">{fmtDate(String(c.start), locale)}</span>
        <span className="tl-track">
          <span className="tl-fill" style={{ width: `${c.pctElapsed}%`, background: color }} />
        </span>
        <span className="small">{fmtDate(String(c.end), locale)}</span>
      </div>
      <span className="muted small">
        {fmtNum(c.pctElapsed, locale, 0)}% {t("pf_elapsed")} ·{" "}
        {c.pctElapsed >= 100
          ? t("pf_contract_ended")
          : t("pf_days_remaining", { n: c.daysRemaining ?? 0 })}
      </span>
    </div>
  );
}

export function VisitTracker({ p }: { p: Profile }) {
  const t = useT();
  const locale = useI18n((s) => s.locale);
  const v = p.visits;
  if (!v) return null;
  const total = v.expected ?? v.completed;
  const segments = total <= 16;
  return (
    <div className="tl-card">
      <strong className="small">{t("pf_visits_title")}</strong>
      <span className="muted small">{t("pf_visits_done", { done: v.completed, total })}</span>
      {segments ? (
        <div className="stage-segments">
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className={`stage-seg${i < v.completed ? " on" : ""}`} />
          ))}
        </div>
      ) : (
        <span className="tl-track">
          <span
            className="tl-fill"
            style={{ width: `${total ? (v.completed / total) * 100 : 0}%`, background: GOOD }}
          />
        </span>
      )}
      {v.lastDate && (
        <span className="muted small">
          {t("pf_last_visit")}: {fmtDate(String(v.lastDate), locale)}
        </span>
      )}
      {v.nextDue ? (
        <span className="muted small">
          {t("pf_next_visit")}: {fmtDate(String(v.nextDue), locale)}
        </span>
      ) : (
        <span className="muted small">{t("pf_visits_complete")}</span>
      )}
    </div>
  );
}

export function FireCard({ p }: { p: Profile }) {
  const t = useT();
  const locale = useI18n((s) => s.locale);
  const f = p.fire;
  if (!f || f.category == null) return null;
  const color = f.category === "low" ? GOOD : f.category === "moderate" ? WARN : CRIT;
  return (
    <div className="tl-card">
      <strong className="small">{t("pf_fire_title")}</strong>
      <span className="small" style={{ color }}>
        ● {t("pf_fire_risk")}: {t(`fire_${f.category}` as Key)}
      </span>
      <span className="muted small">
        {f.burnedPct != null && f.burnedPct > 0
          ? t("pf_fire_burned", { pct: fmtNum(f.burnedPct, locale, 1) })
          : t("pf_fire_none")}
      </span>
    </div>
  );
}

export function PerformanceDonut({ p }: { p: Profile }) {
  const t = useT();
  const locale = useI18n((s) => s.locale);
  const perf = p.performance;
  if (!perf) return null;
  const natural = p.activityGroup === "natural_regeneration";
  const pct = natural ? perf.observedLandCoverPct : perf.achievedPct;
  if (pct == null) return null;
  const [lo, hi] = natural ? [40, 70] : [30, 70];
  const color = pct < lo ? CRIT : pct < hi ? WARN : GOOD;
  const r = 40;
  const c = 2 * Math.PI * r;
  return (
    <div className="tl-card perf-card">
      <strong className="small">{t(`perf_title_${p.activityGroup}` as Key)}</strong>
      <div className="perf-row">
        <svg viewBox="0 0 100 100" className="perf-donut" role="img" aria-label={`${fmtNum(pct, locale, 0)}%`}>
          <circle cx="50" cy="50" r={r} fill="none" stroke="var(--grid)" strokeWidth="12" />
          <circle
            cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="12"
            strokeDasharray={`${(pct / 100) * c} ${c}`} strokeLinecap="round"
            transform="rotate(-90 50 50)"
          />
          <text x="50" y="47" textAnchor="middle" className="perf-num">{fmtNum(pct, locale, 0)}%</text>
          <text x="50" y="62" textAnchor="middle" className="perf-sub">
            {natural ? t("perf_cover") : t("perf_achieved")}
          </text>
        </svg>
        <div className="perf-figures small">
          {perf.achievedHa != null && (
            <span>{t(`perf_main_${p.activityGroup}` as Key)}: <strong>{fmtNum(perf.achievedHa, locale)} ha</strong></span>
          )}
          {perf.gapHa != null && (
            <span>{t(`perf_gap_${p.activityGroup}` as Key)}: <strong>{fmtNum(perf.gapHa, locale)} ha</strong></span>
          )}
          {perf.monitoredTotalHa != null && (
            <span className="muted">{t("perf_total")}: {fmtNum(perf.monitoredTotalHa, locale)} ha</span>
          )}
          {perf.observedTrees != null && (
            <span className="muted">{t("perf_trees")}: {fmtNum(perf.observedTrees, locale, 0)}</span>
          )}
          {natural && perf.observedLandCover && (
            <span className="muted">{t("perf_land_cover")}: {perf.observedLandCover}</span>
          )}
        </div>
      </div>
    </div>
  );
}

export function AreaComparison({ p }: { p: Profile }) {
  const t = useT();
  const locale = useI18n((s) => s.locale);
  const rows = [
    [t("area_estimated"), p.areas.estimatedHa],
    [t("area_declared"), p.areas.declaredHa],
    [t("area_contracted"), p.areas.contractedHa],
    [t(`perf_main_${p.activityGroup}` as Key), p.areas.achievedHa],
  ].filter(([, v]) => v != null) as [string, number][];
  if (rows.length < 2) return null;
  const max = Math.max(...rows.map(([, v]) => v)) || 1;
  return (
    <figure className="chart barlist">
      <figcaption>{t("area_comparison")}</figcaption>
      {rows.map(([label, v]) => (
        <div className="barlist-row" key={label}>
          <span className="barlist-label" title={label}>{label}</span>
          <span className="barlist-track">
            <span className="barlist-bar" style={{ width: `${(v / max) * 100}%` }} />
          </span>
          <span className="barlist-value">{fmtNum(v, locale)} ha</span>
        </div>
      ))}
    </figure>
  );
}

type Row = [string, string | number | null | undefined];

function Section({ title, rows }: { title: string; rows: Row[] }) {
  const filled = rows.filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (!filled.length) return null;
  return (
    <section className="pf-section">
      <h3>{title}</h3>
      <table className="pf-rows">
        <tbody>
          {filled.map(([label, v]) => (
            <tr key={label}>
              <td>{label}</td>
              <td>{String(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function ProfileSections({ p }: { p: Profile }) {
  const t = useT();
  const locale = useI18n((s) => s.locale);
  const species = p.contract?.species
    .map((s) => (s.densityPerHa != null ? `${s.name ?? "?"} — ${fmtNum(s.densityPerHa, locale, 0)}/ha` : s.name))
    .filter(Boolean)
    .join(", ");
  return (
    <div className="pf-grid">
      <Section
        title={t("sec_application")}
        rows={[
          [t("row_code"), p.applicationCode],
          [t("row_status"), p.stage?.status],
          [t("row_date"), p.applicationDate ? fmtDate(String(p.applicationDate), locale) : null],
          [t("row_activity"), p.activity],
          [t("area_estimated"), p.areas.estimatedHa != null ? `${fmtNum(p.areas.estimatedHa, locale)} ha` : null],
        ]}
      />
      <Section
        title={t("sec_beneficiary")}
        rows={
          p.beneficiary
            ? [
                [t("row_ben_type"), p.beneficiary.type],
                [t("row_ben_status"), p.beneficiary.status],
                [t("row_gender"), p.beneficiary.gender],
                [t("row_family"), p.beneficiary.familySituation],
                [t("row_dependents"), p.beneficiary.dependents],
                [t("row_community"), p.beneficiary.communityMembers],
              ]
            : []
        }
      />
      <Section
        title={t("sec_project")}
        rows={[
          [t("row_project"), p.project.name],
          [t("row_org"), p.project.org],
          [t("row_acronym"), p.project.orgAcronym],
          [t("row_aggregator"), p.project.aggregator],
        ]}
      />
      <Section
        title={t("sec_contract")}
        rows={
          p.contract
            ? [
                [t("row_code"), p.contract.code],
                [t("row_status"), p.contract.status],
                [t("row_start"), p.contract.start ? fmtDate(String(p.contract.start), locale) : null],
                [t("row_end"), p.contract.end ? fmtDate(String(p.contract.end), locale) : null],
                [t("row_duration"), p.contract.durationYears != null ? `${fmtNum(p.contract.durationYears, locale, 0)} ${t("years")}` : null],
                [t("area_declared"), p.contract.declaredAreaHa != null ? `${fmtNum(p.contract.declaredAreaHa, locale)} ha` : null],
                [t("area_contracted"), p.contract.contractedAreaHa != null ? `${fmtNum(p.contract.contractedAreaHa, locale)} ha` : null],
                [t("row_species"), species || null],
              ]
            : []
        }
      />
    </div>
  );
}

export function ProfileFooter({ p }: { p: Profile }) {
  const t = useT();
  const locale = useI18n((s) => s.locale);
  return (
    <p className="muted small">
      {p.geometrySource === "polygon_inherited"
        ? t("geom_from_visit")
        : p.geometrySource === "polygon"
          ? t("geom_from_application")
          : null}
      {p.lastSync ? ` · ${t("pf_synced")}: ${fmtDate(String(p.lastSync).slice(0, 10), locale)}` : null}
    </p>
  );
}
