import { describe, expect, it } from "vitest";
import { ISSUE_CODES } from "../../../src/engine/issues.ts";
import type { Issue } from "../../../src/engine/issues.ts";
import en from "../../../web/src/i18n/en.json";
import fr from "../../../web/src/i18n/fr.json";
import { createI18n } from "../../../web/src/i18n/i18n.ts";
import { gameName } from "../../../web/src/names.ts";
import { stubData, text } from "./stubData.ts";

/** The parameters the engine sends with each message key (src/engine: choices, abilities, progression, validate). */
const ENGINE_PARAMS: Record<string, Record<string, string | number>> = {
  "issue.abilityAboveMax": { ability: "Strength", value: 21 },
  "issue.abilityOutOfRange": { ability: "Strength", value: 18 },
  "issue.alreadyExpert": { item: "Skill_X" },
  "issue.alreadyKnown": { item: "Item_X" },
  "issue.choiceMissing": { selector: "SelectSpells" },
  "issue.duplicateChoice": { item: "Item_X" },
  "issue.featAlreadyTaken": { feat: "Feat_X" },
  "issue.itemFoundLater": { item: "Item_X", act: 1, foundAct: 2 },
  "issue.itemSharedInAct": { item: "Item_X", act: 1, other: "Origin_X" },
  "issue.itemWrongSlot": { item: "Item_X", slot: "Slot_X", act: 1 },
  "issue.multiclassDisabled": { class: "Class_X" },
  "issue.notInList": { item: "Item_X", list: "list-uuid" },
  "issue.notProficient": { item: "Skill_X" },
  "issue.offData": { selector: "SelectSpells" },
  "issue.offHandWithTwoHanded": { item: "Item_X", act: 1 },
  "issue.pointBuyOverBudget": { spent: 30, budget: 27 },
  "issue.pointBuyUnderBudget": { spent: 25, budget: 27 },
  "issue.preparedMissing": { count: 1, expected: 3 },
  "issue.preparedNotOffered": { class: "Class_X" },
  "issue.preparedTooMany": { count: 4, expected: 3 },
  "issue.requirementNotMet": { feat: "Feat_X", requirement: "ability_min", ability: "Strength", value: 13, actual: 12 },
  "issue.requirementNotMet.proficiency": { feat: "Feat_X", requirement: "proficiency", proficiency: "Prof_X" },
  "issue.skillAlreadyGranted": { item: "Skill_X", source: "background" },
  "issue.subclassNotOffered": { class: "Class_X", subclass: "Sub_X" },
  "issue.subclassUnlockedInPlay": { subclass: "Sub_X", parent: "Class_X" },
  "issue.subraceMismatch": { race: "Race_X", subrace: "Subrace_X" },
  "issue.swapNotKnown": { item: "Item_X" },
  "issue.tooManyLevels": { count: 13, max: 12 },
  "issue.tooManySwaps": { count: 2, max: 1 },
  "issue.unknownBackground": { background: "Bg_X" },
  "issue.unknownClass": { class: "Class_X" },
  "issue.unknownEquipmentSlot": { slot: "Slot_X" },
  "issue.unknownFeat": { feat: "Feat_X" },
  "issue.unknownItem": { item: "Item_X" },
  "issue.unknownRace": { race: "Race_X" },
  "issue.unknownSlot": {},
  "issue.unknownSubrace": { subrace: "Subrace_X" },
  "issue.wrongCount": { count: 3, expected: 2 },
  "issue.wrongCount.max": { count: 3, max: 1 },
  "issue.wrongCount.item": { item: "Strength", count: 3, max: 1 },
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
  it("use only the parameters the engine sends for each code, and render them all", () => {
    for (const lang of ["en", "fr"] as const) {
      const table: Record<string, string> = lang === "en" ? en : fr;
      // `issue.source.*` words fill the `{source}` of another message; they are no message of their own.
      const issueKeys = Object.keys(table).filter((key) => key.startsWith("issue.") && !key.startsWith("issue.source."));
      expect(issueKeys.sort()).toEqual(Object.keys(ENGINE_PARAMS).sort());
      const { issueMessage } = createI18n(lang);
      for (const [key, sent] of Object.entries(ENGINE_PARAMS)) {
        const placeholders = [...(table[key] ?? "").matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
        for (const name of placeholders) expect(sent, `${lang} ${key} uses {${name}}`).toHaveProperty([name!]);
        const [, code, variant] = /^issue\.(\w+)(?:\.(\w+))?$/.exec(key)!;
        const params = variant === "proficiency" ? { ...sent, requirement: "proficiency" } : sent;
        const message = issueMessage(issue(code as Issue["code"], params), (_kind, id) => `<${id}>`);
        // Identifiers go through the names function (shown here as <id>); numbers are shown as they are.
        const shown = (name: string, value: string | number | undefined) =>
          typeof value === "number" ? String(value) : name === "source" ? table[`issue.source.${value}`]! : `<${value}>`;
        const expected = placeholders.reduce<string>((text, name) => text.replace(`{${name}}`, shown(name!, params[name!])), table[key]!);
        expect(message, `${lang} ${key}`).toBe(expected);
      }
    }
  });

  it("render a placeholder the engine left empty as a question mark, never as braces", () => {
    for (const lang of ["en", "fr"] as const) {
      const { issueMessage } = createI18n(lang);
      for (const code of ISSUE_CODES) {
        const message = issueMessage(issue(code, {}), (_kind, id) => id);
        expect(message, `${lang} ${code}`).not.toMatch(/[{}]/);
        expect(message.trim()).not.toBe("");
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

  it("name a skill issue's item as a skill and word where a granted skill comes from", () => {
    const names = (kind: string | null, id: string) => `${kind}:${id}`;
    expect(createI18n("en").issueMessage(issue("skillAlreadyGranted", { item: "Persuasion", source: "background" }), names)).toBe(
      "skill:Persuasion is already granted by the background: this pick adds nothing.",
    );
    expect(createI18n("fr").issueMessage(issue("skillAlreadyGranted", { item: "Stealth", source: "subrace" }), names)).toBe(
      "La maîtrise de skill:Stealth est déjà accordée par la sous-race : ce choix ne rapporte rien.",
    );
    expect(createI18n("en").issueMessage(issue("notProficient", { item: "Arcana" }), names)).toBe("Expertise needs proficiency in skill:Arcana.");
    expect(createI18n("en").issueMessage(issue("alreadyExpert", { item: "Arcana" }), names)).toBe("skill:Arcana already has expertise.");
  });

  it("name an equipment slot by its slot text and the other characters by origin, the player by the interface", () => {
    const names = (kind: string | null, id: string) => `${kind}:${id}`;
    expect(createI18n("en").issueMessage(issue("itemWrongSlot", { item: "WPN_X", slot: "Helmet", act: 1 }), names)).toBe("null:WPN_X cannot go in the slot:Helmet slot.");
    expect(createI18n("fr").issueMessage(issue("itemSharedInAct", { item: "WPN_X", other: "player, Shadowheart", act: 2 }), names)).toBe(
      "null:WPN_X est aussi équipé par Joueur, origin:Shadowheart à l’acte 2.",
    );
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
