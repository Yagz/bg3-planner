import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
      items: [],
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

  it("exits 3 on unreadable input and usage errors", () => {
    expect(cli("validate", "not a run").code).toBe(3);
    expect(cli("decode", join(dir, "missing")).code).toBe(3);
    expect(cli("frobnicate").code).toBe(3);
    expect(cli("validate").code).toBe(3);
    expect(cli("validate", runFile, "--lang", "de").code).toBe(3);
    expect(cli("slots", runFile, "nobody").code).toBe(3);
    expect(cli("validate", "not a run").err).not.toBe("");
  });

  it("exits 4 with a one-line error when the tool itself fails", () => {
    const deep = join(dir, "deep.json");
    const run = JSON.stringify(rangerRun(1));
    writeFileSync(deep, run.replace('"notes":""', `"notes":${"[".repeat(20000)}${"]".repeat(20000)}`));
    const result = cli("validate", deep);
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

  it("lists the duplicated game rows as alternatives until one of them holds a choice", async () => {
    const a = "01115231-fa37-4cd2-b750-5f282c8ab667";
    const b = "59505762-9251-463c-a81b-420e9a14c8cd";
    const run = rangerRun(3);
    const fighter = run.characters[0]!;
    fighter.levels = [{ class: "Fighter", choices: {} }, { class: "Fighter", choices: {} }, { class: "Fighter", choices: { "subclass:Fighter": ["BattleMaster"] } }];
    const open = cli("slots", await encode(run), "c1");
    expect(open.code).toBe(0);
    expect(open.out).toContain(`alternative rows (fill one): ${a}, ${b}`);
    expect(open.out).toContain(`${a}/0:`);
    expect(open.out).toContain(`${b}/0:`);
    fighter.levels[2]!.choices[`${a}/0`] = "todo";
    const chosen = cli("slots", await encode(run), "c1");
    expect(chosen.out).toContain(`${a}/0:`);
    expect(chosen.out).not.toContain(`${b}/0`);
    expect(chosen.out).not.toContain("alternative rows");
  });
});
