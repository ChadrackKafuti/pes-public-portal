import { useState } from "react";
import type { PesRsObject } from "@cafi/shared";
import { fmtDate, fmtNum, useI18n, useT } from "../i18n";

const W = 640;
const H = 220;
const PAD = { top: 16, right: 44, bottom: 28, left: 48 };

/**
 * Tree cover over the family timeline: one series (slot-1 blue), dot-and-line,
 * per-mark hover tooltip, recessive grid, no legend box (single series — the
 * title names it). Points with treeCoverHa === null are skipped: blank is not
 * zero, so the line breaks rather than dips.
 */
export function TreeCoverChart({ rows }: { rows: PesRsObject[] }) {
  const t = useT();
  const locale = useI18n((s) => s.locale);
  const [hover, setHover] = useState<number | null>(null);

  const points = rows
    .map((r, i) => ({ ...r, i }))
    .filter((r) => r.treeCoverHa !== null);
  if (points.length < 2) return null;

  const xs = points.map((p) => new Date(p.objectDate).getTime());
  const ys = points.map((p) => p.treeCoverHa as number);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const yMax = Math.max(...ys) * 1.15 || 1;
  const px = (x: number) =>
    PAD.left + ((x - x0) / Math.max(1, x1 - x0)) * (W - PAD.left - PAD.right);
  const py = (y: number) => H - PAD.bottom - (y / yMax) * (H - PAD.top - PAD.bottom);

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${px(new Date(p.objectDate).getTime())},${py(p.treeCoverHa as number)}`)
    .join(" ");
  const gridYs = [0.25, 0.5, 0.75, 1].map((f) => yMax * f);

  return (
    <figure className="chart">
      <figcaption>{t("chart_tree_cover")}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("chart_tree_cover")}>
        {gridYs.map((g) => (
          <g key={g}>
            <line
              x1={PAD.left} x2={W - PAD.right} y1={py(g)} y2={py(g)}
              stroke="var(--grid)" strokeWidth="1"
            />
            <text x={PAD.left - 6} y={py(g) + 4} textAnchor="end" className="axis-text">
              {fmtNum(g, locale, yMax < 10 ? 1 : 0)}
            </text>
          </g>
        ))}
        <line
          x1={PAD.left} x2={W - PAD.right} y1={py(0)} y2={py(0)}
          stroke="var(--axis)" strokeWidth="1"
        />
        <path d={path} fill="none" stroke="var(--series-1)" strokeWidth="2" />
        {points.map((p, i) => {
          const cx = px(new Date(p.objectDate).getTime());
          const cy = py(p.treeCoverHa as number);
          return (
            <g key={p.objectId}>
              {/* 2px surface ring so overlapping marks stay separable */}
              <circle cx={cx} cy={cy} r="6" fill="var(--bg)" />
              <circle cx={cx} cy={cy} r="4" fill="var(--series-1)" />
              {/* oversized hit target for hover */}
              <circle
                cx={cx} cy={cy} r="14" fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
              <text
                x={cx} y={H - PAD.bottom + 16}
                textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
                className="axis-text"
              >
                {fmtDate(p.objectDate, locale)}
              </text>
            </g>
          );
        })}
        {hover !== null && (() => {
          const p = points[hover];
          const cx = px(new Date(p.objectDate).getTime());
          const cy = py(p.treeCoverHa as number);
          const label = `${p.objectType === "application" ? t("application") : t("visit")} · ${fmtNum(p.treeCoverHa, locale)} ha`;
          const boxW = label.length * 6.6 + 16;
          const bx = Math.min(Math.max(cx - boxW / 2, PAD.left), W - PAD.right - boxW);
          return (
            <g pointerEvents="none">
              <rect x={bx} y={cy - 34} width={boxW} height="22" rx="4" className="tooltip-box" />
              <text x={bx + boxW / 2} y={cy - 19} textAnchor="middle" className="tooltip-text">
                {label}
              </text>
            </g>
          );
        })()}
      </svg>
    </figure>
  );
}
