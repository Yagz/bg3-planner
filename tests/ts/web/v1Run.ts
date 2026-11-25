import { emptyRun } from "../../../src/plan/model.ts";

/** A v1 document: no id, no updatedAt, one character with choices at two levels. */
export function v1Document() {
  const { id: _i, updatedAt: _u, ...rest } = emptyRun("r1");
  return {
    ...rest,
    version: 1,
    name: "Old",
    characters: [
      {
        id: "c1",
        who: "player",
        race: "Race_X",
        subrace: null,
        background: "Bg_X",
        abilities: { Strength: 15, Dexterity: 14, Constitution: 13, Intelligence: 8, Wisdom: 10, Charisma: 8 },
        levels: [
          { class: "Class_X", choices: { "uuid-1/0": ["Skill_A", "Skill_B"], "uuid-2/0": "todo" } },
          { class: "Class_X", choices: { "uuid-3/1": ["Spell_A"] } },
        ],
        items: ["Item_A"],
        notes: "kept",
      },
    ],
  };
}

export async function v1String(): Promise<string> {
  const stream = new Blob([new TextEncoder().encode(JSON.stringify(v1Document()))]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  return "BG3P1:" + btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
