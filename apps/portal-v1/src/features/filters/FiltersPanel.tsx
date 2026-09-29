import "@esri/calcite-components/components/calcite-combobox";
import "@esri/calcite-components/components/calcite-combobox-item";
import "@esri/calcite-components/components/calcite-input-date-picker";
import { useEffect, useState } from "react";
import { Check, RotateCcw } from "lucide-react";
import { useT } from "@/i18n";
import { CONFIG } from "@/config";
import { findField, uniqueValues } from "@/filters";
import { activeFilterCount, useAppStore } from "@/core/store";
import { useMapStore } from "@/features/map/mapStore";
import { sql } from "@/services/query";
import { Button, Label, LiveRegion, Skeleton } from "@/components/ui";
import s from "./FiltersPanel.module.css";

type Options = Record<string, string[]>;

/** Loads the option lists (from the applications layer) and re-loads cascading ones when the country changes. */
function useFilterOptions(): { options: Options; loading: boolean } {
  const pes = useMapStore((m) => m.pes);
  const countries = useAppStore((st) => st.draft.values["country"]);
  const countryKey = (countries ?? []).join("|");
  // loading is derived: the stored options belong to another country selection (or none yet)
  const [state, setState] = useState<{ key: string | null; options: Options }>({ key: null, options: {} });

  useEffect(() => {
    const layer = pes?.applications;
    if (!layer) return;
    let cancelled = false;
    (async () => {
      const next: Options = {};
      const countryField = findField(layer, ["country"]);
      const selected = countryKey ? countryKey.split("|") : [];
      const scoped = selected.length && countryField ? `${countryField} IN (${selected.map(sql).join(",")})` : "1=1";
      await Promise.all(
        CONFIG.filters.map(async (def) => {
          const field = findField(layer, def.fields);
          if (!field) return;
          next[def.id] = await uniqueValues(layer, field, def.cascadesOnCountry ? scoped : "1=1").catch(() => []);
        }),
      );
      if (!cancelled) setState({ key: countryKey, options: next });
    })();
    return () => {
      cancelled = true;
    };
  }, [pes, countryKey]);

  return { options: state.options, loading: state.key !== countryKey };
}

export function FiltersPanel({ count }: { count: number | null }) {
  const t = useT();
  const draft = useAppStore((st) => st.draft);
  const setDraft = useAppStore((st) => st.setDraft);
  const setDraftValue = useAppStore((st) => st.setDraftValue);
  const apply = useAppStore((st) => st.applyFilters);
  const reset = useAppStore((st) => st.resetFilters);
  const { options, loading } = useFilterOptions();
  const active = activeFilterCount(draft);

  const readValues = (el: HTMLCalciteComboboxElement): string[] => {
    const v = el.value;
    return Array.isArray(v) ? v.filter(Boolean) : v ? [String(v)] : [];
  };

  return (
    <div className={`${s.panel} calcite-mode-dark`}>
      {CONFIG.filters.map((def) => (
        <label key={def.id} className={s.field}>
          <Label>{t(`filter.${def.id}` as "filter.country")}</Label>
          {loading && !options[def.id] ? (
            <Skeleton height={30} />
          ) : (
            <calcite-combobox
              label={t(`filter.${def.id}` as "filter.country")}
              selectionMode="multiple"
              scale="s"
              overlayPositioning="fixed"
              placeholder={t("filter.any")}
              disabled={!options[def.id]?.length}
              oncalciteComboboxChange={(e: Event) => setDraftValue(def.id, readValues(e.currentTarget as HTMLCalciteComboboxElement))}
            >
              {(options[def.id] ?? []).map((v) => (
                <calcite-combobox-item key={v} value={v} heading={v} selected={draft.values[def.id]?.includes(v) ?? false} />
              ))}
            </calcite-combobox>
          )}
        </label>
      ))}

      <label className={s.field}>
        <Label>{t("filter.code")}</Label>
        <input
          className={s.input}
          type="text"
          value={draft.code}
          placeholder={t("filter.codePlaceholder")}
          onChange={(e) => setDraft({ code: e.target.value })}
        />
      </label>

      <div className={s.field}>
        <Label>{t("filter.period")}</Label>
        <div className={s.dates}>
          <calcite-input-date-picker
            scale="s"
            overlayPositioning="fixed"
            placeholder={t("filter.from")}
            value={draft.from}
            oncalciteInputDatePickerChange={(e: Event) => setDraft({ from: ((e.currentTarget as HTMLCalciteInputDatePickerElement).value as string) || "" })}
          />
          <calcite-input-date-picker
            scale="s"
            overlayPositioning="fixed"
            placeholder={t("filter.to")}
            value={draft.to}
            oncalciteInputDatePickerChange={(e: Event) => setDraft({ to: ((e.currentTarget as HTMLCalciteInputDatePickerElement).value as string) || "" })}
          />
        </div>
      </div>

      <div className={s.actions}>
        <Button tone="dark" full icon={<Check size={16} aria-hidden="true" />} onClick={apply}>
          {t("filter.apply")}
          {active > 0 && <span className={s.count}>{active}</span>}
        </Button>
        <Button tone="dark" variant="secondary" icon={<RotateCcw size={16} aria-hidden="true" />} onClick={reset} aria-label={t("filter.reset")}>
          {t("filter.reset")}
        </Button>
      </div>
      <p className={s.matches} aria-hidden="true">
        {count !== null && t("filter.matches", { n: count })}
      </p>
      <LiveRegion>{count !== null ? t("filter.matches", { n: count }) : ""}</LiveRegion>
    </div>
  );
}
