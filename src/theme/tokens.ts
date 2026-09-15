/**
 * TypeScript mirror of theme/tokens.css for consumers that cannot read CSS variables
 * (Chart.js, ArcGIS symbols). A test asserts both files agree.
 */
export const color = {
  primary: "#1b365d",
  primaryDeep: "#0f2340",
  primaryContainer: "#00468b",
  primaryFixed: "#d1e4ff",
  accent: "#0d6e95",
  brand: "#1aa48f",
  brandInk: "#0f7a6b",
  ink: "#191c1e",
  inkMuted: "#44474e",
  muted: "#64748b",
  border: "#e1e6ed",
  surface: "#f8f9fc",
  surfaceLow: "#f1f3f6",
  surfaceLowest: "#ffffff",
  surfaceHigh: "#e7e8eb",
  success: "#2d6a4f",
  warning: "#b45309",
  danger: "#ba1a1a",
} as const;

export const mapUi = {
  bg: "#012f54",
  bgDeep: "#031c2c",
  panelBg: "rgba(3, 28, 44, 0.82)",
  panelStrong: "rgba(3, 28, 44, 0.94)",
  border: "rgba(255, 255, 255, 0.16)",
  borderStrong: "rgba(255, 255, 255, 0.34)",
  text: "#ffffff",
  textMuted: "rgba(255, 255, 255, 0.72)",
  textFaint: "rgba(255, 255, 255, 0.45)",
  accent: "#56c7f4",
  accentSoft: "rgba(86, 199, 244, 0.16)",
  accentBorder: "rgba(86, 199, 244, 0.6)",
  warn: "#f4a261",
  danger: "#f87171",
} as const;

/** Chart series colours (validated categorical palette: green for tree cover, orange for loss). */
export const chart = {
  treeCover: "#008300",
  loss: "#eb6834",
  grid: "rgba(0,0,0,0.08)",
  ink: color.inkMuted,
} as const;

/** CSS custom property names for the values above (used by the parity test). */
export const cssVars: Record<string, string> = {
  "--color-primary": color.primary,
  "--color-primary-deep": color.primaryDeep,
  "--color-primary-container": color.primaryContainer,
  "--color-primary-fixed": color.primaryFixed,
  "--color-accent": color.accent,
  "--color-brand": color.brand,
  "--color-brand-ink": color.brandInk,
  "--ink": color.ink,
  "--ink-muted": color.inkMuted,
  "--muted": color.muted,
  "--border": color.border,
  "--surface": color.surface,
  "--surface-low": color.surfaceLow,
  "--surface-lowest": color.surfaceLowest,
  "--surface-high": color.surfaceHigh,
  "--success": color.success,
  "--warning": color.warning,
  "--danger": color.danger,
  "--map-bg": mapUi.bg,
  "--map-bg-deep": mapUi.bgDeep,
  "--map-panel-bg": mapUi.panelBg,
  "--map-panel-strong": mapUi.panelStrong,
  "--map-border": mapUi.border,
  "--map-border-strong": mapUi.borderStrong,
  "--map-text": mapUi.text,
  "--map-text-muted": mapUi.textMuted,
  "--map-text-faint": mapUi.textFaint,
  "--map-accent": mapUi.accent,
  "--map-accent-soft": mapUi.accentSoft,
  "--map-accent-border": mapUi.accentBorder,
  "--map-warn": mapUi.warn,
  "--map-danger": mapUi.danger,
};

export const breakpoints = { sm: 640, md: 900, lg: 1200 } as const;
