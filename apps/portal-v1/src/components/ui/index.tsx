/** Presentational atoms (CSS Modules). Dark variants are for the glass map UI, light ones for dashboard pages. */
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { useId, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import s from "./ui.module.css";

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

export type Tone = "dark" | "light";

// ---------------------------------------------------------------- glass
export function Glass({
  strong,
  pad = true,
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { strong?: boolean; pad?: boolean }) {
  return (
    <div className={cx(s.glass, strong && s.glassStrong, pad && s.glassPad, className)} {...rest}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- buttons
export function IconButton({
  label,
  active,
  tone = "dark",
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; tone?: Tone }) {
  return (
    <button
      type="button"
      className={cx(s.iconButton, tone === "light" && s.iconButtonLight, active && s.iconButtonActive, className)}
      aria-label={label}
      title={label}
      aria-pressed={active === undefined ? undefined : active}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Button({
  variant = "primary",
  size = "md",
  tone = "light",
  full,
  icon,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  tone?: Tone;
  full?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cx(
        s.button,
        s[variant],
        tone === "dark" && s.dark,
        size === "sm" && s.buttonSm,
        size === "lg" && s.buttonLg,
        full && s.buttonFull,
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- small atoms
export function Chip({
  tone = "dark",
  onRemove,
  removeLabel = "Remove",
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone; onRemove?: () => void; removeLabel?: string }) {
  return (
    <span className={cx(s.chip, tone === "light" && s.chipLight, className)} {...rest}>
      {children}
      {onRemove && (
        <button type="button" className={s.chipRemove} onClick={onRemove} aria-label={removeLabel}>
          <X size={12} />
        </button>
      )}
    </span>
  );
}

export function Badge({ kind = "neutral", children }: { kind?: "neutral" | "success" | "warning" | "danger" | "info"; children: ReactNode }) {
  const map = { neutral: s.badgeNeutral, success: s.badgeSuccess, warning: s.badgeWarning, danger: s.badgeDanger, info: s.badgeInfo };
  return <span className={cx(s.badge, map[kind])}>{children}</span>;
}

export function Swatch({ color, round }: { color: string; round?: boolean }) {
  return <span className={s.swatch} style={{ background: color, borderRadius: round ? "50%" : undefined }} aria-hidden="true" />;
}

export function Label({ tone = "dark", children, className, ...rest }: HTMLAttributes<HTMLParagraphElement> & { tone?: Tone }) {
  return (
    <p className={cx(s.label, tone === "light" && s.labelLight, className)} {...rest}>
      {children}
    </p>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={s.toggle}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
    />
  );
}

export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 5,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label: string;
}) {
  return (
    <input
      type="range"
      className={s.slider}
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={label}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

// ---------------------------------------------------------------- cards
export function Card({
  title,
  subtitle,
  icon,
  actions,
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLElement> & { title?: ReactNode; subtitle?: ReactNode; icon?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={cx(s.card, className)} {...rest}>
      {(title || actions) && (
        <header className={s.cardHeader}>
          {icon}
          <div>
            {title && <h3 className={s.cardTitle}>{title}</h3>}
            {subtitle && <p className={s.cardSubtitle}>{subtitle}</p>}
          </div>
          {actions && <div className={s.cardActions}>{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function KpiCard({
  icon,
  value,
  unit,
  label,
  note,
  accent,
  tone = "dark",
  loading,
}: {
  icon?: ReactNode;
  value: ReactNode;
  unit?: string;
  label: string;
  note?: ReactNode;
  accent?: string;
  tone?: Tone;
  loading?: boolean;
}) {
  return (
    <div className={cx(s.kpi, tone === "dark" && s.kpiDark)} style={accent ? ({ "--kpi-accent": accent } as React.CSSProperties) : undefined}>
      {icon && <span className={s.kpiIcon}>{icon}</span>}
      {loading ? (
        <Skeleton height={28} width="60%" />
      ) : (
        <div className={s.kpiValue}>
          {value}
          {unit && <span className={s.kpiUnit}>{unit}</span>}
        </div>
      )}
      <div className={s.kpiLabel}>{label}</div>
      {note && <div className={s.kpiNote}>{note}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- collapsible
export function CollapsibleSection({
  title,
  defaultOpen = true,
  tone = "dark",
  badge,
  children,
}: {
  title: ReactNode;
  defaultOpen?: boolean;
  tone?: Tone;
  badge?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className={cx(s.collapsible, tone === "light" && s.collapsibleLight)}>
      <button type="button" className={s.collapsibleHead} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        {title}
        {badge}
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      <div id={id} className={s.collapsibleBody} hidden={!open}>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- tabs
export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
}
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  tone = "dark",
  ariaLabel,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  tone?: Tone;
  ariaLabel: string;
}) {
  const onKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const i = items.findIndex((t) => t.id === value);
    let next: T | null = null;
    if (e.key === "ArrowRight") next = items[(i + 1) % items.length].id;
    if (e.key === "ArrowLeft") next = items[(i - 1 + items.length) % items.length].id;
    if (next) {
      e.preventDefault();
      onChange(next);
      (e.currentTarget.parentElement?.querySelector(`#tab-${next}`) as HTMLElement | null)?.focus();
    }
  };
  return (
    <div role="tablist" aria-label={ariaLabel} className={cx(s.tablist, tone === "light" && s.tablistLight)}>
      {items.map((t) => (
        <button
          key={t.id}
          role="tab"
          id={`tab-${t.id}`}
          aria-selected={t.id === value}
          aria-controls={`panel-${t.id}`}
          tabIndex={t.id === value ? 0 : -1}
          className={s.tab}
          onClick={() => onChange(t.id)}
          onKeyDown={onKey}
        >
          {t.icon}
          {t.label}
          {t.badge != null && <span className={s.tabBadge}>{t.badge}</span>}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- feedback
export function Notice({
  kind = "info",
  tone = "dark",
  title,
  action,
  children,
  role,
}: {
  kind?: "info" | "warning" | "danger";
  tone?: Tone;
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  role?: "alert" | "status";
}) {
  const map = { info: s.noticeInfo, warning: s.noticeWarning, danger: s.noticeDanger };
  return (
    <div className={cx(s.notice, map[kind], tone === "light" && s.noticeLight)} role={role ?? (kind === "danger" ? "alert" : "status")}>
      <div className={s.noticeBody}>
        {title && <p className={s.noticeTitle}>{title}</p>}
        {children}
      </div>
      {action}
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return <span className={s.spinner} role="status" aria-label={label} />;
}

export function Skeleton({ width = "100%", height = 14 }: { width?: number | string; height?: number | string }) {
  return <span className={s.skeleton} style={{ display: "block", width, height }} aria-hidden="true" />;
}

export function LiveRegion({ children, assertive }: { children: ReactNode; assertive?: boolean }) {
  return (
    <div className="visually-hidden" aria-live={assertive ? "assertive" : "polite"} aria-atomic="true">
      {children}
    </div>
  );
}

export function VisuallyHidden({ as: Tag = "span", children }: { as?: "span" | "h1" | "h2" | "p"; children: ReactNode }) {
  return <Tag className="visually-hidden">{children}</Tag>;
}

// ---------------------------------------------------------------- bottom sheet (mobile panel)
export function BottomSheet({
  snap,
  onSnap,
  children,
  strong = true,
  label,
}: {
  snap: "peek" | "half" | "full";
  onSnap: (s: "peek" | "half" | "full") => void;
  children: ReactNode;
  strong?: boolean;
  label: string;
}) {
  const heights = { peek: "120px", half: "50%", full: "92%" };
  const next = { peek: "half", half: "full", full: "peek" } as const;
  return (
    <Glass strong={strong} pad={false} className={s.sheet} style={{ height: heights[snap] }} role="dialog" aria-label={label}>
      <button type="button" className={s.sheetHandle} onClick={() => onSnap(next[snap])} aria-label={label}>
        <span />
      </button>
      <div className={cx(s.sheetBody, "scroll")}>{children}</div>
    </Glass>
  );
}
