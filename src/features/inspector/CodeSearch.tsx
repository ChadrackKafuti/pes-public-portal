import { useState } from "react";
import { Search, X } from "lucide-react";
import { useT } from "@/i18n";
import { useMapStore } from "@/features/map/mapStore";
import { searchByCode } from "@/services/layers";
import { selectGraphicOnMap } from "@/features/map/selection";
import s from "./CodeSearch.module.css";

/** "Find by application code" box on the map (glass). */
export function CodeSearch() {
  const t = useT();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = useMapStore((m) => m.status === "ready");

  const run = async () => {
    const code = value.trim();
    const { pes, el, view } = useMapStore.getState();
    if (!code || !pes || !el || !view) return;
    setBusy(true);
    setError(null);
    try {
      const g = await searchByCode(pes, code, view);
      if (!g?.geometry) {
        setError(t("search.notFound", { code }));
        return;
      }
      (g.layer as { visible?: boolean }).visible = true;
      await el.goTo(g.geometry.type === "point" ? { target: g.geometry, scale: 20000 } : g.geometry);
      await selectGraphicOnMap(g);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className={s.box}
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        void run();
      }}
    >
      <button type="submit" className={s.submit} aria-label={t("search.label")} disabled={!ready || busy}>
        <Search size={16} aria-hidden="true" />
      </button>
      <input
        className={s.input}
        type="search"
        value={value}
        placeholder={t("search.placeholder")}
        aria-label={t("search.label")}
        aria-invalid={!!error}
        aria-describedby={error ? "code-search-error" : undefined}
        disabled={!ready || busy}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          // the map element stops key events from bubbling to the form: submit here
          if (e.key === "Enter") {
            e.preventDefault();
            void run();
          }
        }}
      />
      {value && (
        <button type="button" className={s.clear} aria-label={t("ui.close")} onClick={() => setValue("")}>
          <X size={14} />
        </button>
      )}
      {error && (
        <p id="code-search-error" className={s.error} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
