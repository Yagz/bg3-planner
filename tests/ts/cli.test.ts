import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encode } from "../../src/plan/codec.ts";
import { emptyRun } from "../../src/plan/model.ts";
import type { Run } from "../../src/plan/model.ts";

const script = join(import.meta.dirname, "../../scripts/run.ts");
let dir: string;
let runFile: string;
let jsonFile: string;
let encoded: string;

function rangerRun(levels: number): Run {
  const run = emptyRun();
  run.name = "CLI fixture";
  run.characters = [
    {
      id: "c1",
      who: "player",
      race: "Human",
      subrace: null,
      background: "",
      abilities: { Strength: 8, Dexterity: 15, Constitution: 14, Intelligence: 8, Wisdom: 13, Charisma: 10 },
      levels: Array.from({ length: levels }, () => ({ class: "Ranger", choices: {} })),
      equipment: { "1": {}, "2": {}, "3": {} },
      notes: "",
    },
  ];
  return run;
}

function cli(...args: string[]) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "bg3-cli-"));
  encoded = await encode(rangerRun(3));
  runFile = join(dir, "run.txt");
  writeFileSync(runFile, `${encoded}\n`);
  jsonFile = join(dir, "run.json");
  writeFileSync(jsonFile, JSON.stringify(rangerRun(3)));
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("run command line", () => {
  it("decodes a string and encodes it back to the same string", () => {
    const decoded = cli("decode", encoded);
    expect(decoded.code).toBe(0);
    expect(JSON.parse(decoded.out).name).toBe("CLI fixture");
    expect(decoded.out).toContain('"_names"');
    expect(decoded.out).toContain('"_casting"');
    const readable = join(dir, "readable.json");
    writeFileSync(readable, decoded.out);
    const again = cli("encode", readable);
    expect(again.code).toBe(0);
    expect(again.out.trim()).toBe(encoded);
  });

  it("reads the run from a file, from JSON and from stdin", () => {
    expect(cli("decode", runFile).code).toBe(0);
    expect(cli("validate", jsonFile).code).toBeGreaterThanOrEqual(1);
    const piped = spawnSync(process.execPath, [script, "decode", "-"], { encoding: "utf8", input: encoded });
    expect(piped.status).toBe(0);
  });

  it("exits 1 for an incomplete run, listing the issues with display names", () => {
    const result = cli("validate", runFile);
    expect(result.code).toBe(1);
    expect(result.out.split("\n")[0]).toContain("incomplete");
    expect(result.out).toMatch(/incomplete c1 level 3 subclass:Ranger choiceMissing/);
    const fr = cli("validate", runFile, "--lang", "fr");
    expect(fr.code).toBe(1);
  });

  it("exits 0 for a valid run and 2 for an invalid one", async () => {
    const valid = emptyRun();
    expect(cli("validate", await encode(valid)).code).toBe(0);
    const bad = rangerRun(1);
    bad.characters[0]!.levels[0]!.class = "NoSuchClass";
    const result = cli("validate", await encode(bad));
    expect(result.code).toBe(2);
    expect(result.out).toMatch(/invalid c1 level 1 class unknownClass/);
  });

  it("still reads a v1 string, migrated to the current version", async () => {
    const { id, updatedAt, difficulty, ...rest } = rangerRun(3);
    const stream = new Blob([new TextEncoder().encode(JSON.stringify({ ...rest, version: 1, difficulty: "" }))]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    const v1 = `BG3P1:${Buffer.from(bytes).toString("base64url")}`;
    const result = cli("validate", v1);
    expect(result.code).toBe(1);
    expect(result.out).toMatch(/incomplete c1 level 3 subclass:Ranger choiceMissing/);
    const decoded = JSON.parse(cli("decode", v1).out);
    expect(decoded).toMatchObject({ version: 4, id: "", updatedAt: null });
  });

  it("decode of a BG3P3 string prints version 4 JSON with equipment", () => {
    const fixture = join(import.meta.dirname, "fixtures", "bg3p3.txt");
    const result = cli("decode", fixture);
    expect(result.code).toBe(0);
    const decoded = JSON.parse(result.out);
    expect(decoded.version).toBe(4);
    expect(decoded.characters[0].items).toBeUndefined();
    expect(decoded.characters[0].equipment).toEqual({
      "1": { Ring: "DEN_Thiefling_Ring1", Ring2: "DEN_Thiefling_Ring3", Helmet: "ARM_Hat", Boots: "MAG_Acrobat_Shoes" },
      "2": {},
      "3": {},
    });
    expect(decoded.characters[0]._names).toHaveProperty("MAG_Acrobat_Shoes");
    expect(decoded.characters[0].notes).toContain("BG3P3 items not placed: DEN_Thiefling_Ring5, NOT_AN_ITEM");
    expect(result.err).toContain("warning: Item NOT_AN_ITEM of c1 could not be placed");
  });

  it("exits 3 on unreadable input and usage errors", () => {
    expect(cli("validate", "not a run").code).toBe(3);
    expect(cli("decode", join(dir, "missing")).code).toBe(3);
    expect(cli("frobnicate").code).toBe(3);
    expect(cli("validate").code).toBe(3);
    expect(cli("validate", runFile, "--lang", "de").code).toBe(3);
    expect(cli("slots", runFile, "nobody").code).toBe(3);
    expect(cli("validate", "not a run").err).not.toBe("");
  });

  it("exits 3 for a document too deeply nested to read", () => {
    const deep = join(dir, "deep.json");
    const run = JSON.stringify(rangerRun(1));
    writeFileSync(deep, run.replace('"notes":""', `"notes":${"[".repeat(20000)}${"]".repeat(20000)}`));
    const result = cli("validate", deep);
    expect(result.code).toBe(3);
    expect(result.err).not.toMatch(/^\s+at /m);
  });

  it.skipIf(process.getuid?.() === 0)("exits 4 with a one-line error when the tool itself fails", () => {
    const locked = join(dir, "locked.json");
    writeFileSync(locked, JSON.stringify(rangerRun(1)));
    chmodSync(locked, 0o000);
    const result = cli("validate", locked);
    expect(result.code).toBe(4);
    expect(result.err).toMatch(/^error: /);
    expect(result.err).not.toMatch(/^\s+at /m);
  });

  it("lists the open slots of a character with the allowed identifiers", () => {
    const result = cli("slots", runFile, "c1");
    expect(result.code).toBe(0);
    expect(result.out).toContain("subclass:Ranger");
    for (const name of ["BeastMaster", "GloomStalker", "Hunter", "Swarmkeeper"]) expect(result.out).toContain(name);
    expect(result.out).toMatch(/GloomStalker \(.+\)/);
    expect(result.out).toContain("level 3");
  });

  it("lists the identical choice of duplicated game rows once, in the first row's slot", async () => {
    const a = "01115231-fa37-4cd2-b750-5f282c8ab667";
    const b = "59505762-9251-463c-a81b-420e9a14c8cd";
    const run = rangerRun(3);
    const fighter = run.characters[0]!;
    fighter.levels = [{ class: "Fighter", choices: {} }, { class: "Fighter", choices: {} }, { class: "Fighter", choices: { "subclass:Fighter": ["BattleMaster"] } }];
    const open = cli("slots", await encode(run), "c1");
    expect(open.code).toBe(0);
    expect(open.out).toContain(`${a}/0: SelectPassives count 3`);
    expect(open.out).not.toContain(b);
    expect(open.out).not.toContain("alternative rows");
  });

  it("marks a subclass unlocked in play among the allowed subclasses", async () => {
    const run = rangerRun(1);
    run.characters[0]!.levels = [{ class: "Paladin", choices: {} }];
    const result = cli("slots", await encode(run), "c1", "--lang", "fr");
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/^ {4}Oathbreaker \(Parjure\) \(unlocked in play\)$/m);
    expect(result.out).toMatch(/^ {4}Devotion \(.+\)$/m);
  });

  it("lists a missing race, subrace, background and class", async () => {
    // Before any pick, a character has no progression row: these are its only open choices.
    const run = rangerRun(1);
    const blank = run.characters[0]!;
    blank.race = "";
    blank.levels[0]!.class = "";
    const result = cli("slots", await encode(run), "c1");
    expect(result.code).toBe(0);
    expect(result.out).not.toContain("No open slots");
    expect(result.out).toMatch(/^  race: /m);
    expect(result.out).toMatch(/^    Human$/m);
    expect(result.out).toMatch(/^    HalfElf \(Half-Elf\)$/m);
    expect(result.out).not.toMatch(/^    Halfling_Lightfoot/m);
    expect(result.out).toMatch(/^  background: /m);
    expect(result.out).toMatch(/^    [0-9a-f-]{36} \(.+\)$/m);
    expect(result.out).toMatch(/level 1 \(no class\)\n  class: .*\n(    .*\n)*    Fighter\n/);
    expect(result.out).not.toMatch(/^    BattleMaster/m);
    expect(result.out).not.toMatch(/^  subrace: /m);

    blank.race = "Halfling";
    const subrace = cli("slots", await encode(run), "c1");
    expect(subrace.out).toMatch(/^  subrace: /m);
    expect(subrace.out).toMatch(/^    Halfling_Lightfoot \(.+\)$/m);
    expect(subrace.out).not.toMatch(/^  race: /m);
  });

  it("slots lists equipment slots with their eligible items", () => {
    const result = cli("slots", runFile, "c1");
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/^equipment act 1$/m);
    expect(result.out).toMatch(/^equipment act 3$/m);
    expect(result.out).toMatch(/^  equipment:1\/Helmet: current empty \(unset\)$/m);
    expect(result.out).toMatch(/^  equipment:2\/MeleeMainHand: /m);
    const section = result.out.split("  equipment:1/Helmet:")[1]!.split("  equipment:1/Cloak:")[0]!;
    expect(section).toMatch(/\n    [A-Za-z_0-9]+ \(.+\)/);
    expect(section).not.toMatch(/\n    ARM_Camp_Boots/);
  });

  it("slots shows the effective equipment value with the act that sets it", async () => {
    const run = rangerRun(1);
    const probe = cli("slots", runFile, "c1").out.split("  equipment:1/Helmet:")[1]!.split("\n")[1]!.trim().split(" ")[0]!;
    run.characters[0]!.equipment = { "1": { Helmet: probe }, "2": {}, "3": { Helmet: null } };
    const result = cli("slots", await encode(run), "c1");
    expect(result.out).toMatch(new RegExp(`^  equipment:1/Helmet: current ${probe}.* \\(from act 1\\)$`, "m"));
    expect(result.out).toMatch(new RegExp(`^  equipment:2/Helmet: current ${probe}.* \\(from act 1\\)$`, "m"));
    expect(result.out).toMatch(/^  equipment:3\/Helmet: current empty \(from act 3\)$/m);
  });

  function clericRun(prepared?: string[]): Run {
    const run = rangerRun(1);
    const cleric = run.characters[0]!;
    cleric.abilities.Wisdom = 15;
    cleric.levels[0] = prepared === undefined ? { class: "Cleric", choices: {} } : { class: "Cleric", choices: {}, prepared };
    return run;
  }

  it("slots lists prepared spells with the expected count and the pool", async () => {
    const result = cli("slots", await encode(clericRun()), "c1");
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/^  prepared: Cleric class level 1, count \d+, current none$/m);
    expect(result.out).toMatch(/^    Target_CureWounds \(Cure Wounds\)$/m);
    const prepared = cli("slots", await encode(clericRun(["Target_CureWounds"])), "c1");
    expect(prepared.out).toMatch(/^  prepared: Cleric class level 1, count \d+, current Target_CureWounds \(Cure Wounds\) \(own list\)$/m);
    expect(cli("slots", runFile, "c1").out).not.toContain("  prepared:");
  });

  it("validate exits 1 with preparedMissing and 2 with preparedTooMany", async () => {
    const missing = cli("validate", await encode(clericRun()));
    expect(missing.code).toBe(1);
    expect(missing.out).toMatch(/incomplete c1 level 1 prepared preparedMissing count=0 expected=\d+/);
    const pool = cli("slots", await encode(clericRun()), "c1").out.split("  prepared:")[1]!.split("\n").slice(1).filter((l) => l.startsWith("    ")).map((l) => l.trim().split(" ")[0]!);
    const tooMany = cli("validate", await encode(clericRun(pool)));
    expect(tooMany.code).toBe(2);
    expect(tooMany.out).toMatch(/invalid c1 level 1 prepared preparedTooMany/);
  });
});
