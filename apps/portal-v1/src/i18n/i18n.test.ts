import { en } from "./en";
import { fr } from "./fr";
import { setLang, t, tFor } from "./index";

describe("i18n dictionaries", () => {
  it("have identical key sets", () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
  });
  it("have no empty strings", () => {
    for (const dict of [en, fr]) {
      for (const [k, v] of Object.entries(dict)) {
        if (typeof v === "string") expect(v.trim(), k).not.toBe("");
        else {
          expect(v.one.trim(), k).not.toBe("");
          expect(v.other.trim(), k).not.toBe("");
        }
      }
    }
  });
  it("interpolates and pluralises", () => {
    setLang("en");
    expect(t("filter.matches", { n: 1 })).toBe("1 application matches the current filters");
    expect(t("filter.matches", { n: 5 })).toBe("5 applications match the current filters");
    expect(t("search.notFound", { code: "X" })).toBe("No application with code X");
    expect(tFor("fr", "nav.map")).toBe("Carte");
    expect(t("nav.map")).toBe("Map");
  });
});
