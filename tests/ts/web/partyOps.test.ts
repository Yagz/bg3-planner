import { beforeAll, describe, expect, it } from "vitest";
import type { GameData } from "../../../src/data/types.ts";
import { decodeJson } from "../../../src/plan/codec.ts";
import { emptyRun } from "../../../src/plan/model.ts";
import { realData } from "./realData.ts";
import { addCharacter, copyPartyFromPreviousAct, setActive, setProgress, setStatus } from "../../../web/src/state/partyOps.ts";

let data: GameData;
beforeAll(() => {
  data = realData();
});

describe("addCharacter", () => {
  it("gives a companion its origin's identity and preset scores, with no choice filled", () => {
    const run = addCharacter(emptyRun("r"), data, "Shadowheart");
    const [shadowheart] = run.characters;
    expect(shadowheart?.who).toBe("Shadowheart");
    expect(shadowheart?.id).not.toBe("");
    expect(shadowheart?.race).toBe("HalfElf");
    expect(shadowheart?.subrace).toBe("HalfElf_High");
    expect(data.rules.backgrounds[shadowheart?.background as string]?.passives).toEqual(["Background_Acolyte"]);
    expect(shadowheart?.levels).toEqual([{ class: "Cleric", choices: {} }]);
    expect(shadowheart?.abilities).toEqual({ Strength: 12, Dexterity: 13, Constitution: 14, Intelligence: 10, Wisdom: 15, Charisma: 8 });
  });

  it("adds an empty player, or the locked fields of the run's origin", () => {
    const empty = addCharacter(emptyRun("r"), data, "player").characters[0]!;
    expect(empty).toMatchObject({ who: "player", race: "", subrace: null, background: "" });
    expect(empty.levels).toEqual([{ class: "", choices: {} }]);
    const stored = addCharacter(emptyRun("r"), data, "player");
    expect(decodeJson(JSON.stringify(stored))).toEqual(stored);

    const locked = { ...emptyRun("r"), origin: "Shadowheart" };
    expect(addCharacter(locked, data, "player").characters[0]).toMatchObject({ who: "player", race: "HalfElf", subrace: "HalfElf_High" });
    const free = { ...emptyRun("r"), origin: "Generic" };
    expect(addCharacter(free, data, "player").characters[0]).toMatchObject({ race: "", background: "" });
  });

  it("refuses an unknown origin and a character already present, leaving the run alone", () => {
    const run = addCharacter(emptyRun("r"), data, "Gale");
    expect(() => addCharacter(run, data, "Gale")).toThrow();
    expect(() => addCharacter(run, data, "Nobody")).toThrow();
    expect(run.characters).toHaveLength(1);
  });
});

describe("party operations", () => {
  const two = () => {
    let run = emptyRun("r");
    run = addCharacter(run, data, "Gale");
    run = addCharacter(run, data, "Karlach");
    return run;
  };

  it("setActive refuses more than partySize, unknown ids and duplicates", () => {
    const run = { ...two(), partySize: 1 };
    const [a, b] = run.characters.map((c) => c.id) as [string, string];
    expect(() => setActive(run, 1, [a, b])).toThrow();
    expect(setActive(run, 1, [a]).party["1"].active).toEqual([a]);
    expect(() => setActive({ ...run, partySize: 4 }, 1, [a, a])).toThrow();
    expect(() => setActive(run, 1, ["nope"])).toThrow();
  });

  it("sets a status per act without touching the other acts", () => {
    const run = two();
    const id = run.characters[0]!.id;
    const next = setStatus(run, 2, id, "alternative");
    expect(next.party["2"].status).toEqual({ [id]: "alternative" });
    expect(next.party["1"].status).toEqual({});
  });

  it("copies the previous act's party only when called", () => {
    let run = two();
    const ids = run.characters.map((c) => c.id);
    run = setStatus(setActive(run, 1, ids), 1, ids[0]!, "core");
    expect(run.party["2"].active).toEqual([]);
    const copied = copyPartyFromPreviousAct(run, 2);
    expect(copied.party["2"]).toEqual({ active: ids, status: { [ids[0]!]: "core" } });
    expect(copied.party["3"].active).toEqual([]);
    expect(() => copyPartyFromPreviousAct(run, 1)).toThrow();
  });

  it("setProgress takes a level of 1 to 12 and an act of 1 to 3", () => {
    expect(setProgress(emptyRun("r"), 7, 2).progress).toEqual({ level: 7, act: 2 });
    expect(() => setProgress(emptyRun("r"), 13, 1)).toThrow();
    expect(() => setProgress(emptyRun("r"), 0, 1)).toThrow();
    expect(() => setProgress(emptyRun("r"), 3, 4 as 1)).toThrow();
  });
});
