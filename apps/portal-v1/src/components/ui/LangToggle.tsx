import { setLang, useLang, useT, type Lang } from "@/i18n";
import s from "./LangToggle.module.css";

export function LangToggle() {
  const lang = useLang();
  const t = useT();
  const langs: Lang[] = ["en", "fr"];
  return (
    <div className={s.group} role="group" aria-label={t("lang.label")}>
      {langs.map((l) => (
        <button key={l} type="button" className={s.item} aria-pressed={lang === l} onClick={() => setLang(l)}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
