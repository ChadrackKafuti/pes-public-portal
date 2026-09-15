import { activeFilterCount, useAppStore } from "./store";

describe("app store", () => {
  beforeEach(() => useAppStore.getState().resetFilters());

  it("applies a draft without aliasing it", () => {
    const s = useAppStore.getState();
    s.setDraftValue("country", ["Gabon"]);
    s.applyFilters();
    s.setDraftValue("country", ["DRC"]);
    expect(useAppStore.getState().applied.values.country).toEqual(["Gabon"]);
    expect(useAppStore.getState().draft.values.country).toEqual(["DRC"]);
  });

  it("counts active filters", () => {
    const s = useAppStore.getState();
    s.setDraftValue("country", ["Gabon"]);
    s.setDraft({ code: " x ", from: "2025-01-01" });
    expect(activeFilterCount(useAppStore.getState().draft)).toBe(3);
  });

  it("selecting a feature opens the overview tab", () => {
    const s = useAppStore.getState();
    s.setTab("layers");
    s.select({ layerTitle: "PES Contracts", layerUrl: "u", oid: 1 });
    expect(useAppStore.getState().tab).toBe("overview");
    expect(useAppStore.getState().panelOpen).toBe(true);
  });
});
