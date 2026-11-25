import { describe, expect, it } from "vitest";
import { ISSUE_CODES } from "../../../src/engine/issues.ts";
import type { Issue } from "../../../src/engine/issues.ts";
import en from "../../../web/src/i18n/en.json";
import fr from "../../../web/src/i18n/fr.json";
import { createI18n } from "../../../web/src/i18n/i18n.ts";
import { gameName } from "../../../web/src/names.ts";
import { stubData, text } from "./stubData.ts";

const ALL_PARAMS = {
  item: "Item_X", list: "list-uuid", count: 3, expected: 2, max: 1, ability: "Strength", value: 18, actual: 12,
  spent: 30, budget: 27, feat: "Feat_X", requirement: "ability_min", proficiency: "Prof_X", class: "Class_X",
  subclass: "Sub_X", parent: "Class_X", race: "Race_X", subrace: "Subrace_X", background: "Bg_X", selector: "SelectSpells",
};

function issue(code: Issue["code"], params: Issue["params"]): Issue {
  return { severity: "invalid", code, character: "c1", level: 1, slot: "s", params };
}

describe("UI strings", () => {
  it("have the same keys in English and French, none empty", () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
    for (const table of [en, fr] as Record<string, string>[]) for (const value of Object.values(table)) expect(value.trim()).not.toBe("");
  });

  it("have a message for every issue code in both languages", () => {
    for (const code of ISSUE_CODES) {
      expect(en).toHaveProperty([`issue.${code}`]);
      expect(fr).toHaveProperty([`issue.${code}`]);
    }
  });

  it("interpolate parameters and show an unknown key as itself", () => {
    const { t } = createI18n("en");
    expect(t("storage.unreadable", { count: 2 })).toContain("2");
    expect(t("no.such.key")).toBe("no.such.key");
    expect(createI18n("fr").t("nav.party")).toBe("Partie");
  });
});

describe("issue messages", () => {
  it("render every code in both languages with no placeholder left", () => {
    for (const lang of ["en", "fr"] as const) {
      const { issueMessage } = createI18n(lang);
      for (const code of ISSUE_CODES) {
        const variants: Issue["params"][] = [ALL_PARAMS, { ...ALL_PARAMS, requirement: "proficiency" }, { count: 3, max: 1 }, { item: "Item_X", count: 3, max: 1 }, {}];
        for (const params of variants) {
          const message = issueMessage(issue(code, params), (_kind, id) => id);
          expect(message, `${lang} ${code}`).not.toMatch(/[{}]/);
          expect(message.trim()).not.toBe("");
        }
      }
    }
  });

  it("show identifiers through the names function, by kind", () => {
    const { issueMessage } = createI18n("en");
    const seen: string[] = [];
    const names = (kind: string | null, id: string) => {
      seen.push(`${kind}:${id}`);
      return `«${id}»`;
    };
    expect(issueMessage(issue("notInList", { item: "Item_X", list: "uuid" }), names)).toContain("«Item_X»");
    expect(issueMessage(issue("subraceMismatch", { race: "Race_X", subrace: "Subrace_X" }), names)).toContain("«Subrace_X»");
    expect(issueMessage(issue("subclassNotOffered", { class: "Class_X", subclass: "A, B" }), names)).toContain("«A», «B»");
    expect(seen).toEqual(expect.arrayContaining(["null:Item_X", "race:Race_X", "race:Subrace_X", "class:Class_X", "class:A", "class:B"]));
  });
});

describe("game names", () => {
  const data = stubData(
    { "class:Wizard": text("Wizard name"), "spell:Shared": text("One"), "passive:Shared": text("One"), "feat:Blank": text("") },
    { "class:Wizard": text("Nom du magicien") },
  );

  it("come from the language's table, by kind or bare", () => {
    expect(gameName(data, "en", "class", "Wizard")).toBe("Wizard name");
    expect(gameName(data, "fr", "class", "Wizard")).toBe("Nom du magicien");
    expect(gameName(data, "en", null, "Shared")).toBe("One");
  });

  it("fall back to the identifier, never a blank", () => {
    expect(gameName(data, "fr", null, "Shared")).toBe("Shared");
    expect(gameName(data, "fr", "spell", "Shared")).toBe("Shared");
    expect(gameName(data, "en", "feat", "Blank")).toBe("Blank");
    expect(gameName(data, "en", "class", "Missing")).toBe("Missing");
  });
});
