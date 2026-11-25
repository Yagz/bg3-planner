import { describe, expect, it } from "vitest";
import { bareNameOf, descriptionOf, nameOf } from "../../src/data/names.ts";

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
