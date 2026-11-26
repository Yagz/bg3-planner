import { describe, expect, it } from "vitest";
import { DATA_FILES, loadGameDataFromUrl } from "../../../web/src/data/loadInBrowser.ts";

function fakeFetch(bodies: Record<string, unknown>, requested: string[]): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    return url in bodies ? new Response(JSON.stringify(bodies[url])) : new Response("missing", { status: 404 });
  }) as typeof fetch;
}

describe("browser data loader", () => {
  it("fetches the listed files under the base and assembles GameData", async () => {
    expect(DATA_FILES).toEqual([
      "data/larian/rules.json", "data/larian/texts.en.json", "data/larian/texts.fr.json", "data/larian/meta.json",
      "data/rules/unlocked_subclasses.json", "data/rules/skills.json", "data/wiki/items.json",
    ]);
    const bodies: Record<string, unknown> = {};
    for (const file of DATA_FILES) bodies[`/bg3-planner/${file}`] = { file };
    bodies["/bg3-planner/data/wiki/items.json"] = { items: { file: "data/wiki/items.json" }, license: "CC BY-NC-SA 4.0" };
    const requested: string[] = [];
    const data = await loadGameDataFromUrl("/bg3-planner/", fakeFetch(bodies, requested));
    expect(requested.sort()).toEqual(DATA_FILES.map((file) => `/bg3-planner/${file}`).sort());
    expect(data).toEqual({
      rules: { file: "data/larian/rules.json" },
      texts: { en: { file: "data/larian/texts.en.json" }, fr: { file: "data/larian/texts.fr.json" } },
      meta: { file: "data/larian/meta.json" },
      unlockedSubclasses: { file: "data/rules/unlocked_subclasses.json" },
      skills: { file: "data/rules/skills.json" },
      wiki: { file: "data/wiki/items.json" },
    });
  });

  it("fetches data/wiki/items.json", async () => {
    const bodies: Record<string, unknown> = {};
    for (const file of DATA_FILES) bodies[`/x/${file}`] = {};
    bodies["/x/data/wiki/items.json"] = { items: { WPN_Dagger: { rarity: "common", locations: [] } } };
    const requested: string[] = [];
    const data = await loadGameDataFromUrl("/x/", fakeFetch(bodies, requested));
    expect(requested).toContain("/x/data/wiki/items.json");
    expect(data.wiki).toEqual({ WPN_Dagger: { rarity: "common", locations: [] } });
  });

  it("adds the missing slash to the base and names the file that failed", async () => {
    const requested: string[] = [];
    await expect(loadGameDataFromUrl("/x", fakeFetch({}, requested))).rejects.toThrow(/data\/larian\/rules\.json.*404/);
    expect(requested[0]?.startsWith("/x/data/")).toBe(true);
  });
});
