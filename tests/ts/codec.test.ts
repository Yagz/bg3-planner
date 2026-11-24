import { describe, expect, it } from "vitest";
import { CodecError, PREFIX, decode, encode, toReadableJson } from "../../src/plan/codec.ts";
import { emptyRun } from "../../src/plan/model.ts";
import type { Run } from "../../src/plan/model.ts";
import { CURRENT_VERSION, migrate } from "../../src/plan/migrations.ts";

function sampleRun(): Run {
  const run = emptyRun();
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
      items: ["MAG_Acrobat_Shoes"],
      notes: "line1\nline2 \"quoted\"",
    },
  ];
  return run;
}

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
    expect(text.startsWith(`${PREFIX}1:`)).toBe(true);
    const decoded = await decode(text);
    expect(decoded.run).toEqual(run);
    expect(decoded.warnings).toEqual([]);
  });

  it("is safe in a URL fragment", async () => {
    const text = await encode(sampleRun());
    expect(text).toMatch(/^[A-Za-z0-9_:-]+$/);
  });

  it("tolerates surrounding whitespace", async () => {
    const text = await encode(emptyRun());
    expect((await decode(`  ${text}\n`)).run).toEqual(emptyRun());
  });
});

describe("readable JSON", () => {
  it("is accepted, hints are ignored and reported", async () => {
    const run = sampleRun();
    const texts = {
      Halfling: { name: "Halfelin", description: null },
      Ranger: { name: "Rôdeur", description: null },
      Skill_Stealth: { name: "Discrétion", description: null },
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

  it("accepts a hand-written _name hint", async () => {
    const run = emptyRun();
    const raw = { ...run, _name: "x" };
    const decoded = await decode(JSON.stringify(raw));
    expect(decoded.run).toEqual(run);
    expect(decoded.warnings).toHaveLength(1);
  });
});

describe("errors", () => {
  it("each failure kind throws a distinct CodecError", async () => {
    const good = await encode(emptyRun());
    const body = good.slice("BG3P1:".length);
    const deflateOfNonJson = await encode(emptyRun()).then(() => "BG3P1:" + btoa("not deflate data").replace(/=+$/, ""));
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
    const raw: Record<string, unknown> = { ...emptyRun() };
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
    expect((await mutate((r) => (r.version = 2))).message).toMatch(/version/);
  });
});

describe("migrations", () => {
  it("an older version goes through the registry", async () => {
    expect(CURRENT_VERSION).toBe(1);
    const old: Record<string, unknown> = { ...emptyRun(), version: 0 };
    delete old["notes"];
    old["comment"] = "legacy";
    const registry = {
      0: (raw: unknown) => {
        const { comment, ...rest } = raw as Record<string, unknown>;
        return { ...rest, version: 1, notes: String(comment) };
      },
    };
    const decoded = await decode(JSON.stringify(old), registry);
    expect(decoded.run.notes).toBe("legacy");
    expect(decoded.run.version).toBe(1);
  });

  it("works for the string form with an older prefix", async () => {
    const old = { ...emptyRun(), version: 0 };
    const stream = new Blob([new TextEncoder().encode(JSON.stringify(old))]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const registry = { 0: (raw: unknown) => ({ ...(raw as object), version: 1 }) };
    expect((await decode(`BG3P0:${b64}`, registry)).run).toEqual(emptyRun());
  });

  it("a missing step, a future version or a version mismatch is an error", async () => {
    expect(() => migrate({}, 0, {})).toThrow(CodecError);
    expect(() => migrate({}, CURRENT_VERSION + 1, {})).toThrow(CodecError);
    await rejects(decode(JSON.stringify({ ...emptyRun(), version: 0 })));
    await rejects(decode(JSON.stringify({ ...emptyRun(), version: 99 })));
    const bad = { 0: (raw: unknown) => raw };
    await rejects(decode(JSON.stringify({ ...emptyRun(), version: 0 }), bad));
  });
});
