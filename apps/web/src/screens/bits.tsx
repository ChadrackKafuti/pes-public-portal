import { useT } from "../i18n";

/** Status colors are reserved status hues (dataviz status palette), shipped
 *  with a text label — never color alone. */
const STATUS: Record<string, { color: string; icon: string }> = {
  ok: { color: "var(--status-good)", icon: "●" },
  partial: { color: "var(--status-warning)", icon: "◐" },
  partial_final: { color: "var(--status-critical)", icon: "○" },
};

export function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="muted">—</span>;
  const s = STATUS[status] ?? { color: "var(--fg-muted)", icon: "·" };
  return (
    <span className="status-badge" style={{ color: s.color }}>
      <span aria-hidden="true">{s.icon}</span> {status}
    </span>
  );
}

/** Hero-number tile (dataviz: a single headline is a stat tile, not a chart). */
export function StatTile({
  label,
  value,
  unit,
  hint,
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
}) {
  const t = useT();
  const missing = value === "—";
  return (
    <div className="stat-tile">
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        {value}
        {!missing && unit ? <span className="stat-unit"> {unit}</span> : null}
      </div>
      <div className="stat-hint">{missing ? t("not_measured") : (hint ?? " ")}</div>
    </div>
  );
}
