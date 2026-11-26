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

  it("keeps the character heading (header.charhead) static: the global sticky header rule is for the app bar only", () => {
    const bare = readFileSync("web/src/app.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((match) => match[1]!.split(",").some((selector) => selector.trim() === ".charhead"));
    expect(rules.map((match) => match[2]!).join(";")).toMatch(/position:\s*static/);
  });

  it("puts the character sidebar above the main column in the one-column layout, as it comes after it in the DOM", () => {
    const bare = readFileSync("web/src/app.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((match) => match[1]!.trim() === ".charside");
    expect(rules.map((match) => match[2]!).join(";")).toMatch(/order:\s*-1/);
  });

  it("keeps [hidden] stronger than display rules, which jsdom cannot show", () => {
    const css = readFileSync("web/src/app.css", "utf8");
    expect(css).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important\s*\}/);
  });

  describe("camp tokens", () => {
    const css = readFileSync("web/src/app.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const COLOUR_TOKENS = [
      "bg", "surface", "surface2", "fg", "muted", "faint", "border", "line", "accent", "accent-bg", "on-accent", "good", "good-bg", "todo", "todo-bg", "bad", "bad-bg",
      "head-bg", "head-fg", "head-muted", "head-accent", "r-common", "r-uncommon", "r-rare", "r-veryrare", "r-legendary",
    ];

    /** The declarations of the first block that opens with this header, as a name -> value map. */
    function block(header: RegExp): Map<string, string> {
      const match = header.exec(css);
      expect(match, `block ${header}`).not.toBeNull();
      const start = css.indexOf("{", match!.index + match![0].length - 1);
      const body = css.slice(start + 1, css.indexOf("}", start));
      return new Map([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+?)\s*(?:;|$)/g)].map((m) => [m[1]!.slice(2), m[2]!]));
    }
    const light = () => block(/:root\s*\{/);
    const darkMedia = () => block(/prefers-color-scheme:\s*dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{/);
    const darkAttr = () => block(/:root\[data-theme="dark"\]\s*\{/);

    function luminance(hex: string): number {
      const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
    }
    function contrast(a: string, b: string): number {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi! + 0.05) / (lo! + 0.05);
    }

    it("defines every token on :root and redefines the same set in both dark blocks", () => {
      for (const theme of [light(), darkMedia(), darkAttr()]) {
        for (const token of COLOUR_TOKENS) expect(theme.get(token), `--${token}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
      expect([...darkMedia().keys()].sort()).toEqual([...darkAttr().keys()].sort());
      for (const token of ["font", "display", "mono"]) expect(light().has(token), `--${token}`).toBe(true);
      expect(light().get("on-accent")).toBe("#fffaf0");
      expect(darkMedia().get("on-accent")).toBe("#1a140d");
      expect(darkAttr().get("on-accent")).toBe("#1a140d");
    });

    it("text tokens reach WCAG AA on their surfaces", () => {
      const pairs: [string, string][] = [
        ["fg", "bg"], ["fg", "surface"], ["muted", "bg"], ["muted", "surface"], ["accent", "surface"], ["accent", "accent-bg"], ["on-accent", "accent"], ["muted", "surface2"], ["surface", "bad"],
        ["good", "good-bg"], ["todo", "todo-bg"], ["bad", "bad-bg"], ["head-fg", "head-bg"], ["head-accent", "head-bg"],
      ];
      for (const [name, theme] of [["light", light()], ["dark media", darkMedia()], ["dark attribute", darkAttr()]] as const) {
        for (const [text, surface] of pairs) {
          expect(contrast(theme.get(text)!, theme.get(surface)!), `${name}: --${text} on --${surface}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    it("Marcellus is only used with weight 400 and no synthesis", () => {
      expect(/(?:^|[;{\s])font-synthesis:\s*none/.test(css)).toBe(true);
      const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selectors: m[1]!.trim(), body: m[2]! }));
      const display = rules.filter((rule) => /font(?:-family)?:[^;]*var\(--display\)/.test(rule.body));
      expect(display.length).toBeGreaterThan(0);
      for (const rule of display) {
        expect(rule.body, rule.selectors).toMatch(/font-weight:\s*400/);
        expect(rule.body, rule.selectors).toMatch(/font-synthesis:\s*none/);
        expect(rule.body, rule.selectors).not.toMatch(/font:[^;]*var\(--display\)/);
      }
    });

    it("the casting-ability badge is never clipped", () => {
      const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => /\.cast(?![\w-])/.test(m[1]!));
      expect(rules.length).toBeGreaterThan(0);
      for (const rule of rules) expect(rule[2]!, rule[1]!.trim()).not.toMatch(/max-width|overflow\s*:\s*hidden/);
    });
  });
});
