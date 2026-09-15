import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cssVars } from "./tokens";

describe("design tokens", () => {
  const css = readFileSync(fileURLToPath(new URL("./tokens.css", import.meta.url)), "utf8");

  it("every TS token matches its CSS custom property", () => {
    for (const [name, value] of Object.entries(cssVars)) {
      const m = css.match(new RegExp(`${name}:\\s*([^;]+);`));
      expect(m, `${name} missing in tokens.css`).not.toBeNull();
      expect(m![1].trim().toLowerCase().replace(/\s+/g, " ")).toBe(value.toLowerCase().replace(/\s+/g, " "));
    }
  });
});
