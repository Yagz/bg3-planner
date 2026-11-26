import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GameData } from "../../../src/data/types.ts";
import { resolve, subclassSlot } from "../../../src/engine/progression.ts";
import { contribution } from "../../../src/engine/contribution.ts";
import { coverage } from "../../../src/engine/coverage.ts";
import { decode, encode } from "../../../src/plan/codec.ts";
import { emptyRun } from "../../../src/plan/model.ts";
import type { Character, Choice, Run } from "../../../src/plan/model.ts";
import App from "../../../web/src/App.tsx";
import type { Lang } from "../../../web/src/i18n/i18n.ts";
import { gameName } from "../../../web/src/names.ts";
import { addCharacter } from "../../../web/src/state/partyOps.ts";
import { createStore } from "../../../web/src/state/storage.ts";
import { runAction, setLanguage } from "./header.ts";
import { MemoryBackend } from "./memoryBackend.ts";
import { StreamingBlob } from "./streamingBlob.ts";
import { realData } from "./realData.ts";

let data: GameData;
beforeAll(() => {
  data = realData();
});
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-theme");
});

/** A Haunted One Lightfoot Halfling Ranger of `levels` levels, its skills and its level-3 subclass chosen, nothing else. */
function ranger(levels: number): Character {
  const hauntedOne = Object.keys(data.rules.backgrounds).find((k) => data.rules.backgrounds[k]!.passives.includes("Background_HauntedOne"))!;
  const c: Character = {
    id: "ranger",
    who: "player",
    race: "Halfling",
    subrace: "Halfling_Lightfoot",
    background: hauntedOne,
    abilities: { Strength: 8, Dexterity: 15, Constitution: 14, Intelligence: 8, Wisdom: 15, Charisma: 10 },
    levels: Array.from({ length: levels }, () => ({ class: "Ranger", choices: {} })),
    items: [],
    notes: "",
  };
  const first = resolve(c, data).levels[0]!;
  const skills = first.slots.find((s) => s.selector.function === "SelectSkills")!;
  (c.levels[0]!.choices as Record<string, Choice>)[skills.id] = ["Stealth", "Perception", "Survival"];
  c.levels[2]!.choices[subclassSlot("Ranger")] = ["GloomStalker"];
  return c;
}

/** The whole app over a store holding `run`, on the Party screen; the language is switched through the interface. */
function setup(run: Run, lang: Lang = "en", store = createStore(new MemoryBackend())) {
  const saved = store.save(run);
  window.history.replaceState(null, "", "#/party");
  render(<App data={data} store={store} settingsBackend={new MemoryBackend()} sessionBackend={new MemoryBackend()} />);
  if (lang === "fr") setLanguage("fr");
  return { store, id: saved.id };
}

function runWith(character: Character, level: number): Run {
  const run = emptyRun("r");
  run.characters = [character];
  run.party["1"].active = [character.id];
  run.progress = { level, act: 1 };
  return run;
}

describe("Party screen", () => {
  it("lays its frames out inside one stack, whatever the screen nests", () => {
    setup(runWith(ranger(4), 3));
    const frames = [...document.querySelectorAll(".frame")];
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) expect(frame.parentElement?.classList.contains("stack")).toBe(true);
  });

  it("the run frame holds difficulty, level reached, current act and party size", () => {
    const run = { ...runWith(ranger(4), 3), name: "Maximus", difficulty: { ruleset: "DIFFICULTY_MEDIUM", overrides: {} } };
    setup(run);
    const frame = screen.getByRole("region", { name: "Maximus" });
    expect(frame.classList.contains("frame")).toBe(true);
    expect(within(frame).getByRole("combobox", { name: "Difficulty" })).toBeTruthy();
    expect(within(frame).getByRole("combobox", { name: "Level reached" })).toBeTruthy();
    expect(within(frame).getByRole("combobox", { name: "Current act" })).toBeTruthy();
    expect(within(frame).getByRole("spinbutton", { name: "Party size" })).toBeTruthy();
    expect(within(frame).getByText(/^Proficiency bonus \+2 · multiclassing allowed$/)).toBeTruthy();
    // The difficulty picker has left the top of the screen.
    expect(frame.parentElement!.classList.contains("stack")).toBe(true);
  });

  it("states a ruleset without multiclassing in the effect note", () => {
    setup({ ...runWith(ranger(4), 3), difficulty: { ruleset: "DIFFICULTY_EASY", overrides: {} } });
    expect(screen.getByText(/^Proficiency bonus \+4 · multiclassing not allowed$/)).toBeTruthy();
  });

  it("shows the party composer, the active group and the ensemble, in that order, and no status", () => {
    let run = addCharacter(runWith(ranger(4), 3), data, "Gale");
    run = addCharacter(run, data, "Karlach");
    const [, gale, karlach] = run.characters as [Character, Character, Character];
    run.party["1"].status = { ranger: "core", [gale.id]: "alternative", [karlach.id]: "bench" };
    run.party["1"].active = ["ranger", gale.id];
    setup(run, "fr");
    const titles = [...document.querySelectorAll(".stack > .frame")].map((frame) => frame.querySelector("h2")?.textContent);
    expect(titles).toEqual(["Partie sans nom", "Qui part en aventure", "Groupe actif", "Ensemble"]);
    for (const status of ["cœur", "alternative", "banc"]) expect(screen.queryByText(status)).toBeNull();
    expect(screen.queryByRole("combobox", { name: /Statut/ })).toBeNull();
    const composer = screen.getByRole("region", { name: "Qui part en aventure" });
    expect(within(composer).getByText("2 / 4")).toBeTruthy();
    expect(within(composer).getByText("Coche qui part en aventure ; les autres attendent au camp, comme dans le jeu.")).toBeTruthy();
    const entry = (name: string) => within(composer).getByRole("checkbox", { name }).closest("li")!;
    expect(within(entry("Gayle")).getByText("dans le groupe")).toBeTruthy();
    expect(within(entry("Karlach")).getByText("au camp")).toBeTruthy();
    expect(within(entry("Joueur")).getByText(/Rôdeur 3/)).toBeTruthy();
  });

  it("shows on a card the classes reached, the identity, the six abilities, what the member brings, the level-12 plan and what is left to decide", () => {
    let run = addCharacter(runWith(ranger(12), 3), data, "Gale");
    // Gale shares the Ranger's background, so both are proficient in its skills: the Ranger's Wisdom makes it the best in Medicine.
    const gale = { ...run.characters[1]!, background: run.characters[0]!.background };
    run = { ...run, characters: [run.characters[0]!, gale] };
    run.party["1"].active = ["ranger", gale.id];
    setup(run, "fr");
    const group = screen.getByRole("region", { name: "Groupe actif" });
    expect(within(group).getByText("Acte 1 · niveau 3 · bonus de maîtrise +2 · 2/4 membres")).toBeTruthy();
    const card = within(group).getAllByRole("article")[0]!;
    expect(within(card).getByText("Joueur")).toBeTruthy();
    const classes = card.querySelector(".cls")!.textContent!;
    expect(classes).toContain("Rôdeur 3");
    expect(classes).toContain("Pisteur des ténèbres");
    const race = gameName(data, "fr", "race", "Halfling_Lightfoot");
    const background = gameName(data, "fr", "background", run.characters[0]!.background as string);
    expect(within(card).getByText(`${race} · ${background}`)).toBeTruthy();
    const tiles = [...card.querySelectorAll(".ab")];
    expect(tiles).toHaveLength(6);
    expect(tiles[0]!.textContent).toMatch(/^FOR8/);
    expect(tiles[4]!.textContent).toMatch(/^SAG15/);

    const brings = contribution(run, data, 3).get("ranger")!;
    expect(brings.only.length).toBeGreaterThan(0);
    expect(brings.best).toContain("Medicine");
    expect(brings.highest.length).toBeGreaterThan(0);
    const items = [...card.querySelectorAll(".brings .contrib > :not(.sep)")].map((item) => item.textContent);
    for (const skill of brings.only) expect(items).toContain(`${gameName(data, "fr", "skill", skill)} · seul`);
    for (const skill of brings.best) expect(items.some((text) => text!.startsWith(gameName(data, "fr", "skill", skill)) && text!.endsWith("★"))).toBe(true);
    for (const ability of brings.highest) expect(items).toContain(`${gameName(data, "fr", "ability", ability)} la plus haute`);
    expect(within(card).getByText("Apport au groupe")).toBeTruthy();
    expect(within(card).getByText(/Plan niveau 12 : Rôdeur 12/)).toBeTruthy();
    expect(within(card).getByText(/^\d+ à décider$/)).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: "Ouvrir le build" }));
    expect(window.location.hash).toBe("#/character/ranger");
  });

  it("says a lone member is alone in the group instead of listing what only it has", () => {
    setup(runWith(ranger(4), 3), "fr");
    const card = screen.getByRole("article");
    expect(within(card).getByText("Seul dans le groupe")).toBeTruthy();
    expect(within(card).queryByText(/· seul$/)).toBeNull();
  });

  it("every member card ends with the level-12 plan and the open button", () => {
    let run = addCharacter(runWith(ranger(12), 3), data, "Gale");
    run.party["1"].active = ["ranger", run.characters[1]!.id];
    setup(run);
    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      const [plan, open] = [...card.children].slice(-2) as HTMLElement[];
      expect(plan!.classList.contains("plan")).toBe(true);
      expect(plan!.textContent).toMatch(/^Level 12 plan: /);
      expect(open!.tagName).toBe("BUTTON");
      expect(open!.textContent).toBe("Open the build");
    }
  });

  it("contributions are plain text, the best of the party marked with a star and the accent class", () => {
    let run = addCharacter(runWith(ranger(12), 3), data, "Gale");
    const gale = { ...run.characters[1]!, background: run.characters[0]!.background };
    run = { ...run, characters: [run.characters[0]!, gale] };
    run.party["1"].active = ["ranger", gale.id];
    setup(run);
    const card = screen.getAllByRole("article")[0]!;
    expect(card.querySelector(".pill.good")).toBeNull();
    expect(card.querySelector(".brings .pill")).toBeNull();
    const best = [...card.querySelectorAll(".brings .contrib .best")];
    expect(best.length).toBeGreaterThan(0);
    for (const mark of best) expect(mark.textContent).toMatch(/ ★$/);
    expect(within(best[0] as HTMLElement).getByRole("img", { name: "best of the party" })).toBeTruthy();
    expect(card.querySelectorAll(".brings .contrib > :not(.sep):not(.best)").length).toBeGreaterThan(0);
    // The legend under the grid explains the star.
    expect(screen.getByText(/^★ best of the party/)).toBeTruthy();
  });

  it("composes the roster as cards that are not pills", () => {
    setup(runWith(ranger(4), 3));
    const roster = document.querySelector(".roster")!;
    expect(roster.tagName).toBe("UL");
    expect(roster.querySelector(".pill")).toBeNull();
  });

  it.each([1, 4, 6])("fills the frame with the cards of %i active members", (count) => {
    let run = { ...runWith(ranger(4), 3), partySize: 6 };
    for (const origin of ["Gale", "Karlach", "Shadowheart", "Laezel", "Astarion"]) run = addCharacter(run, data, origin);
    run.party["1"].active = run.characters.slice(0, count).map((c) => c.id);
    setup(run);
    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(count);
    const container = cards[0]!.parentElement!;
    expect(container.classList.contains("cards")).toBe(true);
    for (const card of cards) expect(card.parentElement).toBe(container);
  });

  it("offers to take up the previous act when nobody is active in an act", () => {
    let run = addCharacter(runWith(ranger(4), 3), data, "Gale");
    run.party["1"].active = ["ranger", run.characters[1]!.id];
    const { store, id } = setup(run, "fr");
    const composer = screen.getByRole("region", { name: "Qui part en aventure" });
    fireEvent.click(within(composer).getByRole("tab", { name: "Acte 2" }));
    const group = screen.getByRole("region", { name: "Groupe actif" });
    expect(within(group).getByText(/Personne n’est dans le groupe à l’acte 2\./)).toBeTruthy();
    expect(within(group).queryByRole("article")).toBeNull();
    fireEvent.click(within(group).getByRole("button", { name: "Reprendre l’acte précédent" }));
    expect(store.load(id)!.party["2"].active).toEqual(run.party["1"].active);
    expect(within(screen.getByRole("region", { name: "Groupe actif" })).getAllByRole("article")).toHaveLength(2);
  });

  it("has nothing to take up in an empty first act", () => {
    const run = runWith(ranger(4), 3);
    run.party["1"].active = [];
    setup(run, "fr");
    const group = screen.getByRole("region", { name: "Groupe actif" });
    expect(within(group).getByText(/Personne n’est dans le groupe à l’acte 1\./)).toBeTruthy();
    expect(within(group).queryByRole("button", { name: "Reprendre l’acte précédent" })).toBeNull();
  });

  it("sums up the group: classes, covered skills out of 18, the gaps and the coverage under each ability", () => {
    // Lae'zel (Soldier, no Medicine) with Wisdom 17 beats the Haunted One Ranger's Medicine total with Wisdom 10.
    let run = addCharacter(runWith({ ...ranger(3), abilities: { ...ranger(3).abilities, Wisdom: 10 } }, 3), data, "Laezel");
    const laezel = { ...run.characters[1]!, abilities: { ...run.characters[1]!.abilities, Wisdom: 17 } };
    run = { ...run, characters: [run.characters[0]!, laezel] };
    run.party["1"].active = [laezel.id, "ranger"];
    setup(run, "fr");
    const ensemble = screen.getByRole("region", { name: "Ensemble" });
    const rows = coverage(run, data, 3);
    const holes = rows.filter((row) => row.proficient.length === 0).map((row) => gameName(data, "fr", "skill", row.skill));
    expect(Object.keys(data.skills)).toHaveLength(18);
    expect(within(ensemble).getByText(`${18 - holes.length} compétences couvertes sur 18`)).toBeTruthy();
    const gaps = ensemble.querySelector(".summary-line .gaps")!;
    expect(gaps.textContent).toBe(`Trous : ${holes.join(", ")}`);
    expect(holes).toContain(gameName(data, "fr", "skill", "Arcana"));
    expect(holes).not.toContain(gameName(data, "fr", "skill", "Medicine"));
    expect(ensemble.querySelector(".summary-line")!.textContent).toMatch(/Classes : .*Rôdeur/);
    const groups = [...ensemble.querySelectorAll(".cov .grp")];
    const abilities = ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"].filter((ability) => Object.values(data.skills).includes(ability as never));
    expect(groups.map((group) => group.querySelector("h4")?.textContent)).toEqual(abilities.map((ability) => gameName(data, "fr", "ability", ability)));
    const dexterity = groups[abilities.indexOf("Dexterity")]!;
    const stealth = within(dexterity as HTMLElement).getByText(gameName(data, "fr", "skill", "Stealth")).closest(".row")!;
    expect(stealth.textContent).toContain("Joueur");
    expect(stealth.querySelector(".pill")).toBeNull();
    const arcana = within(groups[abilities.indexOf("Intelligence")] as HTMLElement).getByText(gameName(data, "fr", "skill", "Arcana")).closest(".row")!;
    expect(arcana.textContent).toContain("personne");
    expect(arcana.classList.contains("gap")).toBe(true);
  });

  it("coverage shows covered skills in neutral text and only gaps in the bad style, with a summary line naming the gaps", () => {
    const run = runWith(ranger(3), 3);
    setup(run);
    const ensemble = screen.getByRole("region", { name: "Overall" });
    const rows = coverage(run, data, 3);
    const holes = rows.filter((row) => row.proficient.length === 0);
    expect(holes.length).toBeGreaterThan(0);
    expect(ensemble.querySelector(".pill")).toBeNull();
    const gapRows = [...ensemble.querySelectorAll(".cov .row.gap")];
    expect(gapRows).toHaveLength(holes.length);
    expect(ensemble.querySelectorAll(".cov .row:not(.gap)")).toHaveLength(rows.length - holes.length);
    const line = ensemble.querySelector(".summary-line .gaps")!.textContent!;
    for (const hole of holes) expect(line).toContain(gameName(data, "en", "skill", hole.skill));
  });

  it("keeps every act's stored status in the export string when the party is edited", async () => {
    let run = addCharacter(runWith(ranger(4), 3), data, "Gale");
    run = addCharacter(run, data, "Karlach");
    const [, gale, karlach] = run.characters as [Character, Character, Character];
    run.party["1"] = { active: ["ranger", gale.id], status: { ranger: "core", [karlach.id]: "bench" } };
    run.party["2"] = { active: [], status: { [gale.id]: "alternative" } };
    run.party["3"] = { active: [karlach.id], status: { [karlach.id]: "core", ranger: "bench" } };
    const statuses = JSON.parse(JSON.stringify([run.party["1"].status, run.party["2"].status, run.party["3"].status]));
    const { store, id } = setup(run);
    fireEvent.click(screen.getByRole("tab", { name: "Act 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Take up the previous act" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Karlach" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Party size" }), { target: { value: "5" } });
    const saved = store.load(id)!;
    expect(saved.party["2"].active).toEqual(["ranger", gale.id, karlach.id]);
    // jsdom's Blob cannot stream, which the export string's compression needs.
    vi.stubGlobal("Blob", StreamingBlob);
    const exported = await encode(saved)
      .then((string) => decode(string))
      .finally(() => vi.unstubAllGlobals());
    expect(exported.warnings).toEqual([]);
    expect([exported.run.party["1"].status, exported.run.party["2"].status, exported.run.party["3"].status]).toEqual(statuses);
  });

  it("saves the progress and the active party through the store", () => {
    let run = runWith(ranger(3), 3);
    run = addCharacter(run, data, "Gale");
    const { store, id } = setup(run);
    fireEvent.change(screen.getByRole("combobox", { name: "Level reached" }), { target: { value: "5" } });
    expect(store.load(id)!.progress).toEqual({ level: 5, act: 1 });
    fireEvent.click(screen.getByRole("checkbox", { name: "Gale" }));
    expect(store.load(id)!.party["1"].active).toEqual(["ranger", store.load(id)!.characters[1]!.id]);
    fireEvent.click(screen.getByRole("tab", { name: "Act 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Take up the previous act" }));
    expect(store.load(id)!.party["2"].active).toHaveLength(2);
    expect(store.history(id).length).toBeGreaterThan(3);
  });

  it("changes the party size; a smaller size keeps every active member and flags the over-full act", () => {
    let run = addCharacter(runWith(ranger(3), 3), data, "Gale");
    run = addCharacter(run, data, "Karlach");
    run.party["1"].active = run.characters.map((c) => c.id);
    const { store, id } = setup(run);
    const size = screen.getByRole("spinbutton", { name: "Party size" }) as HTMLInputElement;
    expect(size.value).toBe("4");
    expect(size.min).toBe("1");
    expect(size.max).toBe("8");
    expect(screen.queryByText(/more than the party size/)).toBeNull();
    fireEvent.change(size, { target: { value: "2" } });
    expect(store.load(id)!.partySize).toBe(2);
    expect(store.load(id)!.party["1"].active).toHaveLength(3);
    expect(screen.getByText("Act 1: 3 active members, more than the party size (2).")).toBeTruthy();
    // Unchecking a member of the over-full act works; checking one back in does not.
    fireEvent.click(screen.getByRole("checkbox", { name: "Gale" }));
    expect(store.load(id)!.party["1"].active).toHaveLength(2);
    expect(screen.getByRole("checkbox", { name: "Gale" })).toHaveProperty("disabled", true);
    expect(screen.queryByText(/more than the party size/)).toBeNull();
    fireEvent.change(size, { target: { value: "9" } });
    expect(store.load(id)!.partySize).toBe(2);
  });

  it("never offers the player's own origin as a companion", () => {
    setup({ ...runWith(ranger(3), 3), origin: "Gale" });
    const select = screen.getByRole("combobox", { name: "Add a character" });
    expect(within(select).queryByRole("option", { name: "Gale" })).toBeNull();
    expect(within(select).getByRole("option", { name: "Karlach" })).toBeTruthy();
  });

  it("adds a companion from the origins and never one already present", () => {
    const { store, id } = setup(runWith(ranger(3), 3));
    const select = screen.getByRole("combobox", { name: "Add a character" });
    expect(within(select).queryByRole("option", { name: "Generic" })).toBeNull();
    expect(within(select).getByRole("option", { name: "Gale" })).toBeTruthy();
    fireEvent.change(select, { target: { value: "Shadowheart" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(store.load(id)!.characters.map((c) => c.who)).toEqual(["player", "Shadowheart"]);
    expect(within(screen.getByRole("combobox", { name: "Add a character" })).queryByRole("option", { name: "Shadowheart" })).toBeNull();
  });

  it("keeps a rename made in the run bar when the party is edited afterwards", () => {
    const { store, id } = setup(runWith(ranger(3), 3));
    runAction("Rename");
    fireEvent.change(screen.getByRole("textbox", { name: "Run name" }), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Level reached" }), { target: { value: "5" } });
    expect(store.load(id)!.name).toBe("Renamed");
    expect(store.load(id)!.progress.level).toBe(5);
  });

  it("shows the error banner when an operation throws, and when the store refuses the save", () => {
    let run = runWith(ranger(3), 3);
    run = addCharacter(run, data, "Gale");
    run.party["1"].active = ["ghost", "ranger"];
    const { store } = setup(run);
    fireEvent.click(screen.getByRole("checkbox", { name: "Gale" }));
    expect(screen.getByRole("alert").textContent).toBe("The change could not be saved: Unknown character: ghost");
    expect(store.history(run.id).length).toBe(1);

    vi.spyOn(store, "save").mockImplementation(() => {
      throw new Error("disk full");
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Level reached" }), { target: { value: "5" } });
    expect(screen.getByRole("alert").textContent).toBe("The change could not be saved: disk full");
  });
});
