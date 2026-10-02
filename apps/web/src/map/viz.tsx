import type { ReactNode } from "react";

/** M13 — small inline SVG visuals for the glass panel (overview + dashboard).
 *  One system with the Analyses charts: tree cover #008300, loss #eb6834,
 *  cyan accent for neutral magnitudes; status hues only for status, always
 *  with the value as text beside them (never color alone). */

export const VIZ = {
  accent: "#56c7f4",
  tc: "#008300",
  loss: "#eb6834",
  good: "#4caf50",
  warn: "#e0a62e",
  bad: "#d64550",
  grid: "rgba(255,255,255,.14)",
} as const;

/** Performance ring: v1 thresholds (30/70) pick the status hue; the centre
 *  carries the figure so color never stands alone. */
export function Donut({
  pct,
  label,
  size = 84,
}: {
  pct: number;
  label: string;
  size?: number;
}) {
  const p = Math.max(0, Math.min(100, pct));
  const color = p >= 70 ? VIZ.good : p >= 30 ? VIZ.warn : VIZ.bad;
  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="viz-donut" role="img" aria-label={`${Math.round(p)}% — ${label}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={VIZ.grid} strokeWidth="7" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${(c * p) / 100} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text x="50%" y="50%" dy="0.35em" textAnchor="middle" className="viz-donut-num">
          {Math.round(p)}%
        </text>
      </svg>
      <span className="viz-donut-label">{label}</span>
    </div>
  );
}

/** Horizontal comparison bars: one hue, labels left, values right. */
export function HBars({
  rows,
  unit = "",
  color = VIZ.accent,
  fmt = (v: number) => String(v),
}: {
  rows: [string, number][];
  unit?: string;
  color?: string;
  fmt?: (v: number) => string;
}) {
  const filled = rows.filter(([, v]) => v != null && !Number.isNaN(v));
  if (!filled.length) return null;
  const max = Math.max(...filled.map(([, v]) => v)) || 1;
  return (
    <div className="viz-bars">
      {filled.map(([label, v]) => (
        <div className="viz-bar-row" key={label}>
          <span className="viz-bar-label" title={label}>
            {label}
          </span>
          <span className="viz-bar-track">
            <span
              className="viz-bar-fill"
              style={{ width: `${Math.max(2, (v / max) * 100)}%`, background: color }}
            />
          </span>
          <span className="viz-bar-value">
            {fmt(v)}
            {unit}
          </span>
        </div>
      ))}
    </div>
  );
}

/** One 100%-stacked split bar (e.g. gender), 2px gaps, legend beneath with
 *  the counts spelled out. Fixed hue order, never cycled. */
const SPLIT_HUES = [VIZ.accent, "#b58de2", "#e0a62e", "#7fd1ae"];

export function SplitBar({ parts }: { parts: [string, number][] }) {
  const filled = parts.filter(([, v]) => v > 0);
  const total = filled.reduce((s, [, v]) => s + v, 0);
  if (!total) return null;
  return (
    <div className="viz-split">
      <div className="viz-split-bar">
        {filled.map(([label, v], i) => (
          <span
            key={label}
            title={`${label}: ${v}`}
            style={{
              width: `${(v / total) * 100}%`,
              background: SPLIT_HUES[i % SPLIT_HUES.length],
            }}
          />
        ))}
      </div>
      <div className="viz-legend">
        {filled.map(([label, v], i) => (
          <span key={label} className="viz-legend-item">
            <i style={{ background: SPLIT_HUES[i % SPLIT_HUES.length] }} />
            {label} · {v}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Annual tree-cover series: loss as thin columns, tree cover as a line with
 *  endpoint labels. Two series → the legend is always rendered. */
export function AnnualChart({
  series,
  tcLabel,
  lossLabel,
  fmt = (v: number) => String(v),
}: {
  series: { year: number; tcHa: number | null; lossHa: number | null }[];
  tcLabel: string;
  lossLabel: string;
  fmt?: (v: number) => string;
}) {
  const pts = series.filter((s) => s.tcHa != null || s.lossHa != null);
  if (pts.length < 2) return null;
  const W = 360;
  const H = 110;
  const padL = 6;
  const padR = 30;
  const padT = 14;
  const padB = 18;
  const maxV = Math.max(...pts.map((s) => Math.max(s.tcHa ?? 0, s.lossHa ?? 0))) || 1;
  const x = (i: number) =>
    padL + (i * (W - padL - padR)) / Math.max(1, pts.length - 1);
  const y = (v: number) => padT + (1 - v / maxV) * (H - padT - padB);
  const line = pts
    .map((s, i) => (s.tcHa != null ? `${i ? "L" : "M"}${x(i)},${y(s.tcHa)}` : ""))
    .join(" ");
  const last = pts[pts.length - 1];
  const hasLoss = pts.some((s) => (s.lossHa ?? 0) > 0);
  return (
    <div className="viz-annual">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={`${tcLabel} ${pts[0].year}–${last.year}`}
      >
        <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke={VIZ.grid} />
        {pts.map(
          (s, i) =>
            s.lossHa != null &&
            s.lossHa > 0 && (
              <rect
                key={`l${s.year}`}
                x={x(i) - 3}
                y={y(s.lossHa)}
                width="6"
                height={Math.max(1, H - padB - y(s.lossHa))}
                rx="2"
                fill={VIZ.loss}
              >
                <title>{`${s.year} — ${lossLabel}: ${fmt(s.lossHa)}`}</title>
              </rect>
            ),
        )}
        <path d={line} fill="none" stroke={VIZ.tc} strokeWidth="2" />
        {pts.map(
          (s, i) =>
            s.tcHa != null && (
              <circle key={`t${s.year}`} cx={x(i)} cy={y(s.tcHa)} r="2.6" fill={VIZ.tc}>
                <title>{`${s.year} — ${tcLabel}: ${fmt(s.tcHa)}`}</title>
              </circle>
            ),
        )}
        {last.tcHa != null && (
          <text x={x(pts.length - 1) + 5} y={y(last.tcHa) + 3} className="viz-axis">
            {fmt(last.tcHa)}
          </text>
        )}
        <text x={padL} y={H - 5} className="viz-axis">
          {pts[0].year}
        </text>
        <text x={W - padR} y={H - 5} textAnchor="end" className="viz-axis">
          {last.year}
        </text>
      </svg>
      <div className="viz-legend">
        <span className="viz-legend-item">
          <i style={{ background: VIZ.tc }} /> {tcLabel}
        </span>
        {hasLoss && (
          <span className="viz-legend-item">
            <i style={{ background: VIZ.loss }} /> {lossLabel}
          </span>
        )}
      </div>
    </div>
  );
}

/** Mini columns (e.g. applications per year), single hue, count on top of
 *  first/last/max columns only. */
export function MiniColumns({
  rows,
  color = VIZ.accent,
}: {
  rows: [string, number][];
  color?: string;
}) {
  if (rows.length < 2) return null;
  const W = 360;
  const H = 86;
  const padB = 16;
  const padT = 12;
  const max = Math.max(...rows.map(([, v]) => v)) || 1;
  const bw = Math.min(26, (W - 8) / rows.length - 4);
  const x = (i: number) => 4 + i * ((W - 8) / rows.length) + ((W - 8) / rows.length - bw) / 2;
  const maxIdx = rows.findIndex(([, v]) => v === max);
  return (
    <svg className="viz-cols" viewBox={`0 0 ${W} ${H}`} width="100%" role="img">
      <line x1="0" y1={H - padB} x2={W} y2={H - padB} stroke={VIZ.grid} />
      {rows.map(([label, v], i) => {
        const h = Math.max(2, (v / max) * (H - padB - padT));
        const showNum = i === 0 || i === rows.length - 1 || i === maxIdx;
        return (
          <g key={label}>
            <rect x={x(i)} y={H - padB - h} width={bw} height={h} rx="3" fill={color}>
              <title>{`${label}: ${v}`}</title>
            </rect>
            {showNum && (
              <text x={x(i) + bw / 2} y={H - padB - h - 3} textAnchor="middle" className="viz-axis">
                {v}
              </text>
            )}
            <text x={x(i) + bw / 2} y={H - 4} textAnchor="middle" className="viz-axis">
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Timeline progress (contract elapsed): track + fill + bound labels. */
export function Progress({
  pct,
  left,
  right,
  caption,
}: {
  pct: number;
  left?: string | null;
  right?: string | null;
  caption?: string;
}) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div className="viz-progress" role="img" aria-label={caption ?? `${Math.round(p)}%`}>
      <div className="viz-progress-track">
        <div className="viz-progress-fill" style={{ width: `${p}%` }} />
      </div>
      <div className="viz-progress-row">
        <span>{left}</span>
        {caption && <span className="viz-progress-caption">{caption}</span>}
        <span>{right}</span>
      </div>
    </div>
  );
}

/** Visit tracker: one dot per expected visit, filled when completed. */
export function Dots({ done, total, label }: { done: number; total: number; label: string }) {
  const n = Math.min(Math.max(total, done), 14);
  return (
    <div className="viz-dots" role="img" aria-label={label}>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} className={i < done ? "on" : ""} />
      ))}
      <span className="viz-dots-label">{label}</span>
    </div>
  );
}

/** A stat tile with an optional accent figure. */
export function Tile({ value, label, sub }: { value: ReactNode; label: string; sub?: string }) {
  return (
    <div className="ovd-tile">
      <strong>{value}</strong>
      <span>{label}</span>
      {sub && <em>{sub}</em>}
    </div>
  );
}
