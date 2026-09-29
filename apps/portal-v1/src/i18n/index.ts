/** Typed EN/FR dictionary with plurals; React subscribes through useSyncExternalStore. */
import { useSyncExternalStore } from "react";
import { en, type Dict, type Key, type Plural } from "./en";
import { fr } from "./fr";

export type Lang = "en" | "fr";
export type Vars = Record<string, string | number>;

const dicts: Record<Lang, Dict> = { en, fr };
const STORAGE_KEY = "pes-portal-lang";
const listeners = new Set<() => void>();
let current: Lang = detect();

function detect(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "fr" || saved === "en") return saved;
  } catch {
    /* storage unavailable */
  }
  return typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("fr") ? "fr" : "en";
}

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = lang;
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function interpolate(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

/** Translate a key; plural entries pick the form from `vars.n` (or `vars.count`). */
export function t(key: Key, vars?: Vars): string {
  const entry = dicts[current][key] ?? dicts.en[key];
  if (entry === undefined) {
    if (import.meta.env.DEV) console.warn(`[i18n] missing key ${key}`);
    return key;
  }
  if (typeof entry === "string") return interpolate(entry, vars);
  const n = Number(vars?.n ?? vars?.count ?? 0);
  const form = new Intl.PluralRules(current === "fr" ? "fr-FR" : "en-GB").select(n) === "one" ? "one" : "other";
  return interpolate((entry as Plural)[form], vars);
}

export function tFor(lang: Lang, key: Key, vars?: Vars): string {
  const prev = current;
  current = lang;
  try {
    return t(key, vars);
  } finally {
    current = prev;
  }
}

/** React hook: re-renders on language change and returns the translator. */
export function useT(): typeof t {
  useSyncExternalStore(subscribe, getLang, getLang);
  return t;
}

export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, getLang);
}

export type { Key };
