import { readFileSync } from "node:fs";
import { cssVars } from "./tokens";

describe("design tokens", () => {
  // vitest is configured with css:false, which also empties ?raw imports: read the file from the project root
  const css = readFileSync("src/theme/tokens.css", "utf8");

  it("every TS token matches its CSS custom property", () => {
    for (const [name, value] of Object.entries(cssVars)) {
      const m = css.match(new RegExp(`${name}:\\s*([^;]+);`));
      expect(m, `${name} missing in tokens.css`).not.toBeNull();
      expect(m![1].trim().toLowerCase().replace(/\s+/g, " ")).toBe(value.toLowerCase().replace(/\s+/g, " "));
    }
  });
});
