import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CodecError, PREFIX, decode, decodeJson, encode, toReadableJson } from "../../src/plan/codec.ts";
import { loadGameData } from "../../src/data/load.ts";
import { emptyRun, isOffData } from "../../src/plan/model.ts";
import type { Run } from "../../src/plan/model.ts";
import { CURRENT_VERSION, MIGRATIONS, migrate } from "../../src/plan/migrations.ts";

function sampleRun(): Run {
  const run = emptyRun("r1");
  run.name = "Anaïs — 日本語 🎲";
  run.decisions = { SavedHalsin: "yes" };
  run.uniqueItems = ["MAG_Acrobat_Shoes"];
  run.characters = [
    {
      id: "c1",
      who: "player",
      race: "Halfling",
      subrace: "LightfootHalfling",
      background: "00000000-0000-0000-0000-000000000001",
      abilities: { Strength: 8, Dexterity: 15, Constitution: 14, Intelligence: 8, Wisdom: 13, Charisma: 10 },
      levels: [
        { class: "Ranger", choices: { "uuid-a/0": ["Skill_Stealth"], "uuid-a/1": "todo", "uuid-a/2": { offData: "Mod ünï ✓" } } },
        { class: "Rogue", choices: {} },
      ],
      equipment: { "1": { Boots: "MAG_Acrobat_Shoes" }, "2": {}, "3": {} },
      notes: "line1\nline2 \"quoted\"",
    },
  ];
  return run;
}

/** The sample run in the shape of versions 1 to 3: a flat, empty `items` list instead of `equipment`. */
function legacySample(): Omit<Run, "characters"> & { characters: unknown[] } {
  const run = sampleRun();
  return { ...run, characters: run.characters.map(({ equipment: _e, ...c }) => ({ ...c, items: [] })) };
}

const NO_EQUIPMENT = { "1": {}, "2": {}, "3": {} };

async function rejects(promise: Promise<unknown>): Promise<CodecError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CodecError);
    expect((error as CodecError).name).toBe("CodecError");
    return error as CodecError;
  }
  throw new Error("expected a CodecError");
}

describe("export string", () => {
  it("round trips losslessly", async () => {
    const run = sampleRun();
    const text = await encode(run);
    expect(text.startsWith(`${PREFIX}4:`)).toBe(true);
    const decoded = await decode(text);
    expect(decoded.run).toEqual(run);
    expect(decoded.warnings).toEqual([]);
  });

  it("is safe in a URL fragment", async () => {
    const text = await encode(sampleRun());
    expect(text).toMatch(/^[A-Za-z0-9_:-]+$/);
  });

  it("tolerates surrounding whitespace", async () => {
    const text = await encode(emptyRun("r1"));
    expect((await decode(`  ${text}\n`)).run).toEqual(emptyRun("r1"));
  });
});

describe("readable JSON", () => {
  it("is accepted, hints are ignored and reported", async () => {
    const run = sampleRun();
    const texts = {
      "race:Halfling": { name: "Halfelin", description: null },
      "class:Ranger": { name: "Rôdeur", description: null },
      "spell:Skill_Stealth": { name: "Discrétion", description: null },
    };
    const json = toReadableJson(run, texts);
    expect(json).toContain("\n  ");
    expect(json).toContain("Rôdeur");
    expect(json).not.toContain("Rogue\":");
    const decoded = await decode(json);
    expect(decoded.run).toEqual(run);
    expect(decoded.warnings).toHaveLength(1);
    expect(decoded.warnings[0]).toMatch(/hint/);
  });

  it("hints the casting ability of the spell slots, and ignores the hint on import", async () => {
    const data = await loadGameData("data/larian");
    const run = emptyRun("r1");
    run.characters = [
      {
        id: "c1", who: "player", race: "Elf", subrace: "Elf_HighElf", background: "",
        abilities: { Strength: 8, Dexterity: 15, Constitution: 14, Intelligence: 8, Wisdom: 13, Charisma: 10 },
        levels: [{ class: "Bard", choices: {} }],
        equipment: { "1": {}, "2": {}, "3": {} }, notes: "",
      },
    ];
    const json = toReadableJson(run, data.texts.en, data);
    const casting = JSON.parse(json).characters[0].levels[0]._casting;
    expect(casting["db13a1fb-7d64-4309-a1c8-e2a5c752ded5/0"]).toBe("Intelligence");
    expect(Object.values(casting)).toContain("Charisma");
    const decoded = await decode(json);
    expect(decoded.run).toEqual(run);
    expect(decoded.warnings).toHaveLength(1);
    expect(decoded.warnings[0]).toMatch(/hint/);
    expect(JSON.parse(toReadableJson(run, data.texts.en)).characters[0].levels[0]._casting).toBeUndefined();
  });

  it("resolves names from the real texts tables, in each language", async () => {
    const data = await loadGameData("data/larian");
    const background = Object.keys(data.rules.backgrounds)[0] ?? "";
    const spell = Object.keys(data.rules.spells)[0] ?? "";
    const run = emptyRun("r1");
    run.characters = [
      {
        id: "c1", who: "player", race: "Halfling", subrace: "LightfootHalfling", background,
        abilities: { Strength: 8, Dexterity: 15, Constitution: 14, Intelligence: 8, Wisdom: 13, Charisma: 10 },
        levels: [{ class: "Ranger", choices: { "x/0": [spell] } }],
        equipment: { "1": {}, "2": {}, "3": {} }, notes: "",
      },
    ];
    for (const lang of ["en", "fr"] as const) {
      const texts = data.texts[lang];
      const parsed = JSON.parse(toReadableJson(run, texts));
      const hints = parsed.characters[0]._names;
      expect(hints["Ranger"]).toBe(texts["class:Ranger"]?.name);
      expect(hints["Halfling"]).toBe(texts["race:Halfling"]?.name);
      expect(hints[background]).toBe(texts[`background:${background}`]?.name);
      expect(parsed.characters[0].levels[0]._names[spell]).toBe(texts[`spell:${spell}`]?.name);
      expect(hints["Ranger"]).toBeTruthy();
    }
    const fr = JSON.parse(toReadableJson(run, data.texts.fr)).characters[0]._names["Ranger"];
    expect(fr).toBe(data.texts.fr["class:Ranger"]?.name);
  });

  it("hints the names of equipped items and prepared spells, and ignores the hints on import", async () => {
    const run = sampleRun();
    run.characters[0]!.equipment = { "1": { Boots: "MAG_Acrobat_Shoes", Cloak: null }, "2": {}, "3": { Helmet: "ARM_Hat" } };
    run.characters[0]!.levels[0]!.prepared = ["Spell_Bless"];
    const texts = {
      "item:MAG_Acrobat_Shoes": { name: "Acrobat Shoes", description: null },
      "item:ARM_Hat": { name: "Hat", description: null },
      "spell:Spell_Bless": { name: "Bless", description: null },
    };
    const parsed = JSON.parse(toReadableJson(run, texts));
    expect(parsed.characters[0]._names).toMatchObject({ MAG_Acrobat_Shoes: "Acrobat Shoes", ARM_Hat: "Hat" });
    expect(parsed.characters[0].levels[0]._names).toMatchObject({ Spell_Bless: "Bless" });
    expect((await decode(JSON.stringify(parsed))).run).toEqual(run);
  });

  it("accepts a hand-written _name hint", async () => {
    const run = emptyRun("r1");
    const raw = { ...run, _name: "x" };
    const decoded = await decode(JSON.stringify(raw));
    expect(decoded.run).toEqual(run);
    expect(decoded.warnings).toHaveLength(1);
  });
});

describe("errors", () => {
  it("each failure kind throws a distinct CodecError", async () => {
    const good = await encode(emptyRun("r1"));
    const body = good.slice("BG3P1:".length);
    const deflateOfNonJson = await encode(emptyRun("r1")).then(() => "BG3P1:" + btoa("not deflate data").replace(/=+$/, ""));
    const messages = [
      (await rejects(decode("XYZ1:abcd"))).message,
      (await rejects(decode("BG3Px:abcd"))).message,
      (await rejects(decode(`BG3P1:${body}!!`))).message,
      (await rejects(decode(deflateOfNonJson))).message,
      (await rejects(decode("{not json"))).message,
      (await rejects(decode(JSON.stringify({ version: 1, name: 3 })))).message,
      (await rejects(decode("[1,2]"))).message,
      (await rejects(decode(""))).message,
    ];
    expect(new Set(messages).size).toBe(messages.length);
  });

  it("a non-JSON payload inside valid compression is a JSON error", async () => {
    const stream = new Blob([new TextEncoder().encode("nope")]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const error = await rejects(decode(`BG3P1:${b64}`));
    expect(error.message).toMatch(/JSON/);
  });

  it("a missing field is an error naming its path", async () => {
    const raw: Record<string, unknown> = { ...emptyRun("r1") };
    delete raw["notes"];
    const error = await rejects(decode(JSON.stringify(raw)));
    expect(error.message).toContain("notes");
  });

  it("names the path of a bad nested field", async () => {
    const run = sampleRun();
    const raw = JSON.parse(JSON.stringify(run));
    raw.characters[0].levels[1].class = 7;
    const error = await rejects(decode(JSON.stringify(raw)));
    expect(error.message).toContain("characters[0].levels[1].class");
  });

  it("rejects unknown keys, bad enums, too many levels and bad choices", async () => {
    const mutate = async (f: (raw: any) => void) => {
      const raw = JSON.parse(JSON.stringify(sampleRun()));
      f(raw);
      return rejects(decode(JSON.stringify(raw)));
    };
    expect((await mutate((r) => (r.typo = 1))).message).toContain("typo");
    expect((await mutate((r) => (r.progress.act = 4))).message).toContain("progress.act");
    expect((await mutate((r) => (r.party["1"].status.x = "nope"))).message).toContain("party.1.status.x");
    expect((await mutate((r) => (r.characters[0].abilities.Luck = 1))).message).toContain("abilities");
    expect((await mutate((r) => delete r.characters[0].abilities.Wisdom)).message).toContain("abilities.Wisdom");
    expect((await mutate((r) => (r.characters[0].levels = Array.from({ length: 13 }, () => ({ class: "Ranger", choices: {} }))))).message).toContain("levels");
    expect((await mutate((r) => (r.characters[0].levels[0].choices["a/0"] = "done"))).message).toContain("choices");
    expect((await mutate((r) => (r.characters[0].levels[0].choices["a/0"] = [1]))).message).toContain("choices");
    expect((await mutate((r) => (r.version = 5))).message).toMatch(/version/);
  });
});

describe("hardening", () => {
  it("encode refuses a run with a bad shape", async () => {
    const run = sampleRun();
    (run.characters[0]!.levels[0] as unknown as { class: unknown }).class = 3;
    const error = await rejects(encode(run));
    expect(error.message).toContain("characters[0].levels[0].class");
  });

  it("decode wraps deep nesting in a CodecError", async () => {
    const raw = JSON.stringify(emptyRun("r1")).replace('"notes":""', `"notes":${"[".repeat(20000)}${"]".repeat(20000)}`);
    await rejects(decode(raw));
  });

  it("decode wraps a failing migration in a CodecError", async () => {
    const registry = { ...MIGRATIONS, 1: () => { throw new TypeError("boom"); } };
    const error = await rejects(decode(JSON.stringify({ ...emptyRun("r1"), version: 1 }), registry));
    expect(error.message).toContain("boom");
  });
});

describe("off-data identity fields", () => {
  it("round trip for race, subrace, background and class", async () => {
    const run = sampleRun();
    const c = run.characters[0]!;
    c.race = { offData: "Mod race ✓" };
    c.subrace = { offData: "Mod subrace" };
    c.background = { offData: "Mod background" };
    c.levels[1]!.class = { offData: "Mod class" };
    const text = await encode(run);
    expect((await decode(text)).run).toEqual(run);
    expect(isOffData(c.race)).toBe(true);
    expect(isOffData("Human")).toBe(false);
    expect(isOffData(null)).toBe(false);
  });

  it("rejects a malformed off-data value naming its path", async () => {
    const raw = JSON.parse(JSON.stringify(sampleRun()));
    raw.characters[0].race = { offData: 3 };
    expect((await rejects(decode(JSON.stringify(raw)))).message).toContain("characters[0].race.offData");
  });

  it("gives no readable-JSON hint to an off-data value", () => {
    const run = sampleRun();
    run.characters[0]!.race = { offData: "Mod race" };
    run.characters[0]!.levels[0]!.class = { offData: "Mod class" };
    const parsed = JSON.parse(toReadableJson(run, { "race:Halfling": { name: "Halfelin", description: null } }));
    expect(parsed.characters[0]._names ?? {}).not.toHaveProperty("Mod race");
    expect(JSON.stringify(parsed.characters[0]._names ?? {})).not.toContain("Mod");
  });
});

describe("__proto__ keys", () => {
  it("are rejected at the top level and as record keys, never silently lost", async () => {
    const top = JSON.stringify(emptyRun("r1")).replace("{", '{"__proto__":{"x":1},');
    expect((await rejects(decode(top))).message).toContain("__proto__");
    const deco = JSON.stringify(emptyRun("r1")).replace('"decisions":{}', '"decisions":{"__proto__":"keep"}');
    expect(deco).toContain("keep");
    expect((await rejects(decode(deco))).message).toContain("decisions.__proto__");
  });
});

describe("migrations", () => {
  it("an older version goes through the registry", async () => {
    expect(CURRENT_VERSION).toBe(4);
    const old: Record<string, unknown> = { ...emptyRun("r1"), version: 0 };
    delete old["notes"];
    old["comment"] = "legacy";
    const registry = {
      ...MIGRATIONS,
      0: (raw: unknown) => {
        const { comment, ...rest } = raw as Record<string, unknown>;
        return { ...rest, version: 1, notes: String(comment) };
      },
    };
    const decoded = await decode(JSON.stringify(old), registry);
    expect(decoded.run.notes).toBe("legacy");
    expect(decoded.run.version).toBe(4);
  });

  it("works for the string form with an older prefix", async () => {
    const { id, updatedAt, ...v0 } = emptyRun("r1");
    const old = { ...v0, version: 0 };
    const stream = new Blob([new TextEncoder().encode(JSON.stringify(old))]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const registry = { ...MIGRATIONS, 0: (raw: unknown) => ({ ...(raw as object), version: 1 }) };
    expect((await decode(`BG3P0:${b64}`, registry)).run).toEqual({ ...emptyRun("r1"), id: "" });
  });

  async function packed(document: unknown): Promise<string> {
    const stream = new Blob([new TextEncoder().encode(JSON.stringify(document))]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  it("migrates a v2 difficulty label to its ruleset", () => {
    const table: [unknown, string][] = [
      ["Explorer", "DIFFICULTY_EASY"], ["Balanced", "DIFFICULTY_MEDIUM"], ["Tactician", "DIFFICULTY_HARD"], ["Honour", "RULESET_HONOUR"],
      ["", ""], ["RULESET_LARIAN", "RULESET_LARIAN"], ["balanced", "DIFFICULTY_MEDIUM"], ["EXPLORER", "DIFFICULTY_EASY"], ["Nightmare", "Nightmare"],
    ];
    for (const [label, ruleset] of table) {
      const migrated = MIGRATIONS[2]!({ version: 2, difficulty: label }, { itemSlot: null, warnings: [], unplaced: [] }) as { version: number; difficulty: unknown };
      expect(migrated.version).toBe(3);
      expect(migrated.difficulty).toEqual({ ruleset, overrides: {} });
    }
  });

  it("decodes a v2 document with a difficulty label to a v3 run", () => {
    const { difficulty: _d, ...rest } = legacySample();
    const run = decodeJson(JSON.stringify({ ...rest, version: 2, difficulty: "Balanced" }));
    expect(run.version).toBe(4);
    expect(run.difficulty).toEqual({ ruleset: "DIFFICULTY_MEDIUM", overrides: {} });
  });

  it("decodes a BG3P1 string through both migrations", async () => {
    const { id, updatedAt, difficulty, ...rest } = legacySample();
    const { run, warnings } = await decode(`BG3P1:${await packed({ ...rest, version: 1, difficulty: "Explorer" })}`);
    expect(warnings).toEqual([]);
    expect(run.version).toBe(4);
    expect(run.id).toBe("");
    expect(run.difficulty).toEqual({ ruleset: "DIFFICULTY_EASY", overrides: {} });
  });

  it("decodes a BG3P2 string", async () => {
    const { difficulty, ...rest } = legacySample();
    const { run } = await decode(`BG3P2:${await packed({ ...rest, version: 2, difficulty: "Tactician" })}`);
    expect(run.difficulty).toEqual({ ruleset: "DIFFICULTY_HARD", overrides: {} });
  });

  it("encodes a difficulty and round-trips", async () => {
    const run = sampleRun();
    run.difficulty = { ruleset: "DIFFICULTY_EASY", overrides: { MULTICLASSING: true, PROFICIENCY_BONUS: 3 } };
    const text = await encode(run);
    expect(text.startsWith("BG3P4:")).toBe(true);
    expect(await decode(text)).toEqual({ run, warnings: [] });
  });

  it("rejects a difficulty that is not an object with a string ruleset and boolean or integer overrides", () => {
    const bad: unknown[] = [
      "Balanced", null, [], {}, { ruleset: 1, overrides: {} }, { ruleset: "", overrides: [] }, { ruleset: "", overrides: { A: "x" } },
      { ruleset: "", overrides: { A: 1.5 } }, { ruleset: "", overrides: null }, { ruleset: "", overrides: {}, extra: 1 },
    ];
    for (const difficulty of bad) {
      expect(() => decodeJson(JSON.stringify({ ...sampleRun(), difficulty }))).toThrow(/difficulty/);
    }
  });

  it("a v1 string decodes to the current version with id \"\" and updatedAt null", async () => {
    const { id, updatedAt, difficulty, ...rest } = legacySample();
    const v1 = { ...rest, version: 1, difficulty: "" };
    const { run, warnings } = await decode(`BG3P1:${await packed(v1)}`);
    expect(warnings).toEqual([]);
    expect(run.version).toBe(4);
    expect(run.id).toBe("");
    expect(run.updatedAt).toBeNull();
    const { id: _i, updatedAt: _u, version: _v, ...others } = run;
    const { version: _w, difficulty: _x, ...expected } = v1;
    const characters = sampleRun().characters.map((c) => ({ ...c, equipment: NO_EQUIPMENT }));
    expect(others).toEqual({ ...expected, characters, difficulty: { ruleset: "", overrides: {} } });
    expect(await decode(await encode(run))).toEqual({ run, warnings: [] });
  });

  it("encodes as BG3P4", async () => {
    expect(PREFIX).toBe("BG3P");
    expect((await encode(emptyRun("r1"))).startsWith("BG3P4:")).toBe(true);
  });

  /** A version-3 document whose first character carries `items` and `notes`. */
  function v3With(items: string[], notes: string) {
    const doc = { ...legacySample(), version: 3 } as Record<string, unknown> & { characters: Record<string, unknown>[] };
    doc.characters[0] = { ...doc.characters[0], items, notes };
    return doc;
  }

  const SLOTS: Record<string, string> = { RING_A: "Ring", RING_B: "Ring", RING_C: "Ring", HELMET_A: "Helmet", HELMET_B: "Helmet", SWORD: "Melee Main Weapon", ODD: "Belt" };
  const itemSlot = (id: string) => SLOTS[id] ?? null;

  it("migrates a version-3 character: rings to Ring then Ring2, other items to their slot at act 1, extras and unplaceable ids to one notes line and one warning each", async () => {
    const doc = v3With(["RING_A", "RING_B", "RING_C", "HELMET_A", "HELMET_B", "NOT_AN_ITEM"], "My notes");
    const { run, warnings } = await decode(`BG3P3:${await packed(doc)}`, MIGRATIONS, { itemSlot });
    const c = run.characters[0]!;
    expect(c.equipment).toEqual({ "1": { Ring: "RING_A", Ring2: "RING_B", Helmet: "HELMET_A" }, "2": {}, "3": {} });
    expect("items" in c).toBe(false);
    expect(c.notes).toBe("My notes\n\nBG3P3 items not placed: RING_C, HELMET_B, NOT_AN_ITEM");
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toMatch(/^Item RING_C of c1 could not be placed: /);
    expect(warnings[1]).toMatch(/^Item HELMET_B of c1 could not be placed: /);
    expect(warnings[2]).toMatch(/^Item NOT_AN_ITEM of c1 could not be placed: /);
  });

  it("places weapons through the data slot names, and an item whose data slot has no equipment slot goes to the notes", () => {
    const run = decodeJson(JSON.stringify(v3With(["SWORD", "ODD"], "")), MIGRATIONS, { itemSlot });
    expect(run.characters[0]!.equipment["1"]).toEqual({ MeleeMainHand: "SWORD" });
    expect(run.characters[0]!.notes).toBe("BG3P3 items not placed: ODD");
  });

  it("without item slots every old item goes to the notes line", async () => {
    const { run, warnings } = await decode(JSON.stringify(v3With(["RING_A", "HELMET_A"], "")));
    expect(run.characters[0]!.equipment).toEqual(NO_EQUIPMENT);
    expect(run.characters[0]!.notes).toBe("BG3P3 items not placed: RING_A, HELMET_A");
    expect(warnings).toHaveLength(2);
    expect(warnings.every((w) => w.startsWith("Item "))).toBe(true);
  });

  it("an empty items list adds no notes line and no warning", async () => {
    const { run, warnings } = await decode(JSON.stringify(v3With([], "kept")), MIGRATIONS, { itemSlot });
    expect(run.characters[0]!.notes).toBe("kept");
    expect(run.characters[0]!.equipment).toEqual(NO_EQUIPMENT);
    expect(warnings).toEqual([]);
  });

  it("migration warnings follow the hint warning", async () => {
    const doc = { ...v3With(["NOT_AN_ITEM"], ""), _name: "hint" };
    const { warnings } = await decode(JSON.stringify(doc), MIGRATIONS, { itemSlot });
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/hint/);
    expect(warnings[1]).toMatch(/NOT_AN_ITEM/);
  });

  it("absent, null and an id stay distinct through encode and decode", async () => {
    const run = sampleRun();
    run.characters[0]!.equipment = { "1": { Helmet: "ARM_Hat", Cloak: null }, "2": { Helmet: null }, "3": {} };
    const decoded = (await decode(await encode(run))).run.characters[0]!.equipment;
    expect(decoded).toEqual(run.characters[0]!.equipment);
    expect(Object.hasOwn(decoded["1"], "Cloak")).toBe(true);
    expect(decoded["1"].Cloak).toBeNull();
    expect(Object.hasOwn(decoded["2"], "Cloak")).toBe(false);
    expect(Object.hasOwn(decoded["3"], "Helmet")).toBe(false);
  });

  it("prepared lists survive a round trip; an empty list stays empty, not absent", async () => {
    const run = sampleRun();
    run.characters[0]!.levels[0]!.prepared = ["Spell_A", "Spell_B"];
    run.characters[0]!.levels[1]!.prepared = [];
    const decoded = (await decode(await encode(run))).run.characters[0]!;
    expect(decoded.levels[0]!.prepared).toEqual(["Spell_A", "Spell_B"]);
    expect(decoded.levels[1]!.prepared).toEqual([]);
    const without = (await decode(await encode(sampleRun()))).run.characters[0]!;
    expect("prepared" in without.levels[0]!).toBe(false);
  });

  it("refuses an equipment value that is neither a string nor null, and an act key other than 1, 2, 3", async () => {
    const mutate = async (f: (raw: any) => void) => {
      const raw = JSON.parse(JSON.stringify(sampleRun()));
      f(raw);
      return rejects(decode(JSON.stringify(raw)));
    };
    expect((await mutate((r) => (r.characters[0].equipment["1"].Helmet = 3))).message).toContain("characters[0].equipment.1.Helmet");
    expect((await mutate((r) => (r.characters[0].equipment["1"].Helmet = ["x"]))).message).toContain("equipment.1.Helmet");
    expect((await mutate((r) => (r.characters[0].equipment["4"] = {}))).message).toContain("equipment.4");
    expect((await mutate((r) => delete r.characters[0].equipment["2"])).message).toContain("equipment.2");
    expect((await mutate((r) => (r.characters[0].equipment = []))).message).toContain("equipment");
    expect((await mutate((r) => (r.characters[0].items = []))).message).toContain("items");
    expect((await mutate((r) => (r.characters[0].levels[0].prepared = "Spell_A"))).message).toContain("levels[0].prepared");
    expect((await mutate((r) => (r.characters[0].levels[0].prepared = [1]))).message).toContain("levels[0].prepared");
    // Any slot key is accepted here: the engine judges it.
    const raw = JSON.parse(JSON.stringify(sampleRun()));
    raw.characters[0].equipment["1"].NotASlot = "X";
    expect((await decode(JSON.stringify(raw))).run.characters[0]!.equipment["1"]).toHaveProperty("NotASlot", "X");
  });

  it("BG3P1, BG3P2 and BG3P3 fixtures still decode", async () => {
    const data = await loadGameData("data/larian");
    const slotOf = (id: string) => data.rules.items[id]?.slot ?? null;
    const expectedDifficulty: Record<number, string> = { 1: "DIFFICULTY_EASY", 2: "DIFFICULTY_HARD", 3: "DIFFICULTY_MEDIUM" };
    for (const version of [1, 2, 3]) {
      const text = readFileSync(join(import.meta.dirname, "fixtures", `bg3p${version}.txt`), "utf8");
      expect(text.startsWith(`BG3P${version}:`)).toBe(true);
      const { run, warnings } = await decode(text, MIGRATIONS, { itemSlot: slotOf });
      expect(run.version).toBe(4);
      expect(run.name).toBe("Fixture run");
      expect(run.difficulty.ruleset).toBe(expectedDifficulty[version]);
      const c = run.characters[0]!;
      expect(c.equipment).toEqual({
        "1": { Ring: "DEN_Thiefling_Ring1", Ring2: "DEN_Thiefling_Ring3", Helmet: "ARM_Hat", Boots: "MAG_Acrobat_Shoes" },
        "2": {},
        "3": {},
      });
      expect(c.notes).toBe("Fixture notes\n\nBG3P3 items not placed: DEN_Thiefling_Ring5, NOT_AN_ITEM");
      expect(warnings).toHaveLength(2);
      const again = await decode(await encode(run));
      expect(again).toEqual({ run, warnings: [] });
    }
  });

  it("a missing step, a future version or a version mismatch is an error", async () => {
    expect(() => migrate({}, 0, {})).toThrow(CodecError);
    expect(() => migrate({}, CURRENT_VERSION + 1, {})).toThrow(CodecError);
    await rejects(decode(JSON.stringify({ ...emptyRun("r1"), version: 0 })));
    await rejects(decode(JSON.stringify({ ...emptyRun("r1"), version: 99 })));
    const bad = { 0: (raw: unknown) => raw };
    await rejects(decode(JSON.stringify({ ...emptyRun("r1"), version: 0 }), bad));
  });
});

describe("synchronous JSON decoding", () => {
  function throwsCodecError(text: string, registry = MIGRATIONS): CodecError {
    try {
      decodeJson(text, registry);
    } catch (error) {
      expect(error).toBeInstanceOf(CodecError);
      return error as CodecError;
    }
    throw new Error("expected a CodecError");
  }

  it("reads the run's JSON and returns the run, not a promise", () => {
    const run = sampleRun();
    expect(decodeJson(JSON.stringify(run))).toEqual(run);
  });

  it("gives the same run as decode, hint fields stripped", async () => {
    const run = sampleRun();
    const text = JSON.stringify({ ...run, _names: { MAG_Acrobat_Shoes: "Acrobat Shoes" } });
    expect(decodeJson(text)).toEqual((await decode(text)).run);
  });

  it("migrates a version 1 document", () => {
    const { id, updatedAt, difficulty, ...rest } = legacySample();
    const run = decodeJson(JSON.stringify({ ...rest, version: 1, difficulty: "" }));
    expect(run.version).toBe(4);
    expect(run.id).toBe("");
    expect(run.updatedAt).toBeNull();
  });

  it("throws nothing but a CodecError", () => {
    const deep = JSON.stringify(emptyRun("r1")).replace('"notes":""', `"notes":${"[".repeat(20000)}${"]".repeat(20000)}`);
    for (const text of ["", "BG3P2:abcd", "{not json", "[1,2]", JSON.stringify({ version: 2 }), deep]) throwsCodecError(text);
    const registry = { ...MIGRATIONS, 1: () => { throw new TypeError("boom"); } };
    expect(throwsCodecError(JSON.stringify({ ...emptyRun("r1"), version: 1 }), registry).message).toContain("boom");
  });
});
