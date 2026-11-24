import { describe, expect, it } from "vitest";
import { bareNameOf, nameOf } from "../../src/data/names.ts";

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
});
