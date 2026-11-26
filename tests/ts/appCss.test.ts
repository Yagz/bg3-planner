import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Every selector of the stylesheet, comments and at-rule headers left out. */
function selectors(css: string): string[] {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...bare.matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap((match) => match[1]!.split(",").map((selector) => selector.trim())).filter((selector) => selector !== "" && !selector.startsWith("@"));
}

describe("app.css", () => {
  it("keeps the ability tiles (.ab6) apart from the abilities table (.abiltable): every .ab rule is scoped under .ab6", () => {
    const tileRules = selectors(readFileSync("web/src/app.css", "utf8")).filter((selector) => /\.ab(?![\w-])/.test(selector));
    expect(tileRules.length).toBeGreaterThan(0);
    expect(tileRules.filter((selector) => !/^\.ab6 \.ab(?![\w-])/.test(selector))).toEqual([]);
    // Both looks are still defined.
    expect(tileRules.some((selector) => selector.startsWith(".ab6 "))).toBe(true);
    expect(selectors(readFileSync("web/src/app.css", "utf8")).some((selector) => selector.startsWith(".abiltable "))).toBe(true);
  });

  it("keeps [hidden] stronger than display rules, which jsdom cannot show", () => {
    const css = readFileSync("web/src/app.css", "utf8");
    expect(css).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important\s*\}/);
  });
});
