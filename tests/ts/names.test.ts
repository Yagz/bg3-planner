import { describe, expect, it } from "vitest";
import { bareNameOf, descriptionOf, nameOf, renderParams } from "../../src/data/names.ts";
import type { ParamFormat } from "../../src/data/names.ts";

const t = (name: string) => ({ name, description: null });

describe("display names", () => {
  const texts = {
    "class:Same": t("One"),
    "spell:Same": t("One"),
    "class:Clash": t("A"),
    "passive:Clash": t("B"),
    "item:Only": t("Solo"),
  };

  it("looks up by kind", () => {
    expect(nameOf(texts, "class", "Clash")).toBe("A");
    expect(nameOf(texts, "passive", "Clash")).toBe("B");
    expect(nameOf(texts, "race", "Clash")).toBeNull();
  });

  it("resolves a bare id only when every kind agrees", () => {
    expect(bareNameOf(texts, "Only")).toBe("Solo");
    expect(bareNameOf(texts, "Same")).toBe("One");
    expect(bareNameOf(texts, "Clash")).toBeNull();
    expect(bareNameOf(texts, "Missing")).toBeNull();
  });

  it("gives a description as plain text, null when there is none", () => {
    const described = {
      "feat:Actor": { name: "Actor", description: 'Your <LSTag Tooltip="Charisma">Charisma</LSTag> rises.<br><br>Also   this.' },
      "spell:Bare": { name: "Bare", description: null },
    };
    expect(descriptionOf(described, "feat", "Actor")).toBe("Your Charisma rises. Also this.");
    expect(descriptionOf(described, "spell", "Bare")).toBeNull();
    expect(descriptionOf(described, "spell", "Missing")).toBeNull();
  });
});

describe("renderParams", () => {
  const damageName = (type: string) => (type === "Acid" ? "Acide" : null);
  const fr: ParamFormat = { lang: "fr", damageName, variable: "(selon le personnage)" };
  const en: ParamFormat = { lang: "en", damageName, variable: "(varies with the character)" };

  it("renders distances with the language's decimal separator", () => {
    expect(renderParams("up to [1].", ["Distance(1.5)"], fr)).toBe("up to 1,5 m.");
    expect(renderParams("up to [1].", ["Distance(1.5)"], en)).toBe("up to 1.5 m.");
    expect(renderParams("[1]", ["Distance(9)"], en)).toBe("9 m");
  });
  it("renders damage with its type name, numbers and dice as written", () => {
    expect(renderParams("[1] and [2]", ["DealDamage(4d4,Acid)", "3"], fr)).toBe("4d4 Acide and 3");
    expect(renderParams("[1]", ["DealDamage(2d6,Unknown)"], fr)).toBe("2d6");
    expect(renderParams("[1] [2]", ["1d4+2", "RegainHitPoints(5)"], fr)).toBe("1d4+2 5");
    expect(renderParams("[1]", ["GainTemporaryHitPoints(5)"], fr)).toBe("5");
    expect(renderParams("[1]", ["RegainHitPoints(Level)"], fr)).toBe("(selon le personnage)");
  });
  it("keeps the damage type name beside the marker for an unrendered damage amount", () => {
    expect(renderParams("[1]", ["DealDamage(LevelMapValue(D8Cantrip),Acid)"], fr)).toBe("(selon le personnage) Acide");
    expect(renderParams("[1]", ["DealDamage(1d8+SpellCastingAbilityModifier, Acid)"], en)).toBe("(varies with the character) Acide");
    expect(renderParams("[1]", ["DealDamage(LevelMapValue(D8Cantrip),Unknown)"], fr)).toBe("(selon le personnage)");
  });
  it("renders a level-dependent, empty, unknown or missing parameter as the marker", () => {
    expect(renderParams("[1]", ["LevelMapValue(EldritchBlast)"], en)).toBe("(varies with the character)");
    expect(renderParams("[1]", [""], en)).toBe("(varies with the character)");
    expect(renderParams("[2]", ["1"], en)).toBe("(varies with the character)");
    expect(renderParams("[1]", ["Whatever(3)"], en)).toBe("(varies with the character)");
  });
  it("leaves a text without placeholders unchanged", () => {
    expect(renderParams("no placeholder", ["1"], en)).toBe("no placeholder");
  });
  it("is applied by descriptionOf before markup is stripped", () => {
    const texts = { "spell:X": { name: "X", description: "Deals <b>[1]</b>." } };
    expect(descriptionOf(texts, "spell", "X", ["DealDamage(4d4,Acid)"], fr)).toBe("Deals 4d4 Acide.");
    expect(descriptionOf(texts, "spell", "X")).toBe("Deals [1].");
  });
});
