import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Every selector of the stylesheet, comments and at-rule headers left out. */
function selectors(css: string): string[] {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...bare.matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap((match) => match[1]!.split(",").map((selector) => selector.trim())).filter((selector) => selector !== "" && !selector.startsWith("@"));
}

describe("app.css", () => {
  it("keeps the ability tiles (.ab6) and the Creation ability block (.abil) apart: every .ab rule is scoped under one of them", () => {
    const tileRules = selectors(readFileSync("web/src/app.css", "utf8")).filter((selector) => /\.ab(?![\w-])/.test(selector));
    expect(tileRules.length).toBeGreaterThan(0);
    expect(tileRules.filter((selector) => !/^\.(ab6|abil) \.ab(?![\w-])/.test(selector))).toEqual([]);
    // Both looks are still defined.
    expect(tileRules.some((selector) => selector.startsWith(".ab6 "))).toBe(true);
    expect(tileRules.some((selector) => selector.startsWith(".abil "))).toBe(true);
  });
});
