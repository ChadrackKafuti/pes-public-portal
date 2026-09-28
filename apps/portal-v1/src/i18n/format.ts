import { getLang } from "./index";

const locale = () => (getLang() === "fr" ? "fr-FR" : "en-GB");

export function fmtNumber(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  return new Intl.NumberFormat(locale(), { maximumFractionDigits: digits }).format(value);
}

export function fmtCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  return new Intl.NumberFormat(locale(), { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function fmtDate(ms: number | null | undefined): string {
  if (!ms) return "–";
  return new Intl.DateTimeFormat(locale(), { year: "numeric", month: "short", day: "numeric" }).format(new Date(ms));
}

export function fmtHa(value: number | null | undefined): string {
  return value === null || value === undefined ? "–" : `${fmtNumber(value, value >= 100 ? 0 : 1)} ha`;
}
