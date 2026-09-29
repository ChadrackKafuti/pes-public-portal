import { decodeFilters, encodeFilters } from "./url";
import { emptyState } from "@/filters";

describe("url codec", () => {
  it("round-trips a filter state", () => {
    const s = emptyState();
    s.values.country = ["Cameroon", "DRC"];
    s.values.status = ["Approved"];
    s.code = "CMR-1";
    s.from = "2025-01-01";
    const back = decodeFilters(new URLSearchParams(encodeFilters(s).toString()));
    expect(back.values.country).toEqual(["Cameroon", "DRC"]);
    expect(back.values.status).toEqual(["Approved"]);
    expect(back.code).toBe("CMR-1");
    expect(back.from).toBe("2025-01-01");
    expect(back.to).toBe("");
  });
  it("encodes an empty state as no params", () => {
    expect(encodeFilters(emptyState()).toString()).toBe("");
  });
});
