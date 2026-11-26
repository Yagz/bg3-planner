// Command line to read, edit and validate run strings. Usage: see USAGE below.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadGameData } from "../src/data/load.ts";
import { bareNameOf, nameOf } from "../src/data/names.ts";
import type { TextKind } from "../src/data/names.ts";
import type { GameData } from "../src/data/types.ts";
import { effectiveEquipment, itemsForSlot } from "../src/engine/equipment.ts";
import { preparedState } from "../src/engine/prepared.ts";
import { resolve } from "../src/engine/progression.ts";
import { validate } from "../src/engine/validate.ts";
import { CodecError, decode, encode, toReadableJson } from "../src/plan/codec.ts";
import { EQUIPMENT_SLOTS } from "../src/plan/equipmentSlots.ts";
import type { Act, EquipmentSlot } from "../src/plan/equipmentSlots.ts";
import { isOffData } from "../src/plan/model.ts";
import type { Run } from "../src/plan/model.ts";

const USAGE = `Usage:
  node scripts/run.ts decode <string|file|->            readable JSON with English _name hints
  node scripts/run.ts encode <file.json|->              export string
  node scripts/run.ts validate <string|file|-> [--lang en|fr]
                                                        report; exit 0 valid, 1 incomplete, 2 invalid, 3 unreadable
  node scripts/run.ts slots <string|file|-> <character id> [equipment:<Slot>] [--lang en|fr]
                                                        open slots with their allowed identifiers, prepared spells by level, equipment value by act;
                                                        with equipment:<Slot>, the items that slot accepts.
                                                        "none" = nothing set anywhere, "empty" = cleared on purpose
Exit 4 (any command): the tool itself failed; this is not a run status.`;

const DATA_DIR = join(import.meta.dirname, "..", "data", "larian");

class UsageError extends Error {}

function fail(message: string, usage = false): never {
  throw new UsageError(usage ? `${message}\n${USAGE}` : message);
}

function readInput(arg: string): string {
  if (arg === "-") return readFileSync(0, "utf8").trim();
  if (existsSync(arg) && statSync(arg).isFile()) return readFileSync(arg, "utf8").trim();
  return arg.trim();
}

/** Splits `--lang` out of the arguments. */
function parseArgs(args: string[]): { positional: string[]; lang: "en" | "fr" } {
  const positional: string[] = [];
  let lang: "en" | "fr" = "en";
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--lang") {
      const value = args[++i];
      if (value !== "en" && value !== "fr") fail(`Invalid --lang ${JSON.stringify(value ?? "")}: expected en or fr`, true);
      lang = value;
    } else if (arg.startsWith("--")) {
      fail(`Unknown option ${arg}`, true);
    } else {
      positional.push(arg);
    }
  }
  return { positional, lang };
}

/** Reads a run; the game data places the items of a run of an older version. */
async function readRun(arg: string, data: GameData): Promise<Run> {
  const { run, warnings } = await decode(readInput(arg), undefined, { itemSlot: (id) => data.rules.items[id]?.slot ?? null });
  for (const warning of warnings) console.error(`warning: ${warning}`);
  return run;
}

function label(id: string, data: GameData, lang: "en" | "fr"): string {
  const name = bareNameOf(data.texts[lang], id);
  return name === null || name === "" || name === id ? id : `${id} (${name})`;
}

/** Label of an identifier of a known kind (race, background, class). */
function kindLabel(kind: TextKind, id: string, data: GameData, lang: "en" | "fr"): string {
  const name = nameOf(data.texts[lang], kind, id);
  return name === null || name === "" || name === id ? id : `${id} (${name})`;
}

function validateCommand(run: Run, data: GameData, lang: "en" | "fr"): number {
  const report = validate(run, data);
  const lines: string[] = [report.status];
  for (const issue of report.issues) {
    const params = Object.entries(issue.params).map(([key, value]) => {
      const shown = typeof value === "string" ? value.split(", ").map((v) => label(v, data, lang)).join(", ") : String(value);
      return `${key}=${shown}`;
    });
    lines.push([issue.severity, issue.character, "level", issue.level ?? "-", issue.slot ?? "-", issue.code, ...params].join(" "));
  }
  console.log(lines.join("\n"));
  return { valid: 0, incomplete: 1, invalid: 2 }[report.status];
}

function slotsCommand(run: Run, data: GameData, lang: "en" | "fr", characterId: string, equipmentSlot?: string): number {
  const character = run.characters.find((c) => c.id === characterId);
  if (character === undefined) fail(`Unknown character id ${JSON.stringify(characterId)}`);
  if (equipmentSlot !== undefined) {
    const name = equipmentSlot.slice("equipment:".length);
    if (!equipmentSlot.startsWith("equipment:") || !(EQUIPMENT_SLOTS as readonly string[]).includes(name)) {
      fail(`Unknown equipment slot ${JSON.stringify(equipmentSlot)}: expected equipment:<Slot> with Slot one of ${EQUIPMENT_SLOTS.join(", ")}`, true);
    }
    const items = itemsForSlot(name as EquipmentSlot, character, data);
    console.log(items.length === 0 ? "No eligible items" : items.map((id) => label(id, data, lang)).join("\n"));
    return 0;
  }
  const { levels } = resolve(character, data);
  const out: string[] = [];
  const undecided = (choices: Record<string, unknown>, slot: string) => {
    const choice = Object.hasOwn(choices, slot) ? choices[slot] : undefined;
    return choice === undefined || choice === "todo";
  };

  // Choices of the character itself, missing in the same cases as `resolve` reports them.
  const { races, backgrounds, classes } = data.rules;
  const pick = (slot: string, kind: TextKind, allowed: string[]) => {
    out.push(`  ${slot}: ${kind} choice count 1`);
    for (const id of allowed) out.push(`    ${kindLabel(kind, id, data, lang)}`);
  };
  const baseRaces = Object.keys(races).filter((id) => races[id]?.parent === null);
  const subraces = Object.keys(races).filter((id) => races[id]?.parent === character.race);
  if (character.race === "") pick("race", "race", baseRaces);
  else if (typeof character.race === "string" && baseRaces.includes(character.race) && character.subrace === null && subraces.length > 0) pick("subrace", "race", subraces);
  if (character.background === "") pick("background", "background", Object.keys(backgrounds));
  if (out.length > 0) out.unshift("character");
  const baseClasses = Object.keys(classes).filter((id) => classes[id]?.parent === null);

  for (const level of levels) {
    const choices = character.levels[level.level - 1]?.choices ?? {};
    const before = out.length;
    const add = (slot: string, header: string, allowed: string[], unlocked: string[] = []) => {
      out.push(`  ${slot}: ${header}`);
      for (const id of allowed) out.push(`    ${label(id, data, lang)}${unlocked.includes(id) ? " (unlocked in play)" : ""}`);
    };
    const offClass = isOffData(character.levels[level.level - 1]?.class);
    out.push(`level ${level.level} (${offClass ? "class outside the game data" : level.class === "" ? "no class" : label(level.class, data, lang)})`);
    if (level.class === "" && !offClass) pick("class", "class", baseClasses);
    for (const slot of level.slots) {
      const selector = slot.selector;
      if (selector.function === "AddSpells" || selector.function === "ReplacePassives") continue;
      if ("count" in selector && selector.count === 0) continue;
      if (!undecided(choices, slot.id)) continue;
      const items = data.rules.lists[selector.list]?.items ?? [];
      const count = "count" in selector ? ` count ${selector.count}` : "";
      add(slot.id, `${selector.function}${count}`, items);
    }
    if (level.subclassChoice !== null && undecided(choices, `subclass:${level.class}`)) {
      add(`subclass:${level.class}`, "subclass choice count 1", level.subclassChoice, level.unlockedSubclasses);
    }
    if (level.featChoice) {
      const slot = `feat:${level.level}`;
      if (undecided(choices, slot)) {
        add(slot, "feat choice count 1", Object.keys(data.rules.feats));
      } else {
        const picked = choices[slot];
        const name = Array.isArray(picked) && picked.length === 1 ? picked[0] : undefined;
        const selectors = name !== undefined && Object.hasOwn(data.rules.feats, name) ? (data.rules.feats[name]?.selectors ?? []) : [];
        selectors.forEach((selector, i) => {
          const id = `${slot}/${i}`;
          if (selector.function === "AddSpells" || selector.function === "ReplacePassives") return;
          if ("count" in selector && selector.count === 0) return;
          if (!undecided(choices, id)) return;
          const count = "count" in selector ? ` count ${selector.count}` : "";
          add(id, `${selector.function}${count}`, data.rules.lists[selector.list]?.items ?? []);
        });
      }
    }
    // Prepared spells of a preparing class: the effective list, where it comes from, the expected count and the pool.
    const state = offClass ? null : preparedState(character, data, level.level);
    if (state !== null) {
      const list = state.list === null ? "none" : state.list.length === 0 ? "empty" : state.list.map((id) => label(id, data, lang)).join(", ");
      const from = state.from === null ? "" : state.from === level.level ? " (own list)" : ` (from level ${state.from})`;
      out.push(`  prepared: ${state.cls} class level ${state.classLevel}, count ${state.count}, current ${list}${from}`);
      for (const id of state.pool) out.push(`    ${label(id, data, lang)}`);
    }
    if (out.length === before + 1) out.pop();
  }

  if (out.length === 0) out.push("No open slots");

  // Equipment: one line per act and slot (value and source); the eligible items are listed on request.
  for (const act of ["1", "2", "3"] as Act[]) {
    const effective = effectiveEquipment(character, act, data);
    out.push(`equipment act ${act}`);
    for (const slot of EQUIPMENT_SLOTS) {
      const { item, source, level: pickLevel } = effective[slot];
      const current = item !== null ? label(item, data, lang) : source === null ? "none" : "empty";
      const from = source === null ? "unset" : source === "level" ? `from level ${pickLevel ?? "?"} pick` : `from act ${source}`;
      out.push(`  equipment:${act}/${slot}: ${current} (${from})`);
    }
  }
  out.push(`To list the items a slot accepts: slots <run> ${characterId} equipment:<Slot>`);
  console.log(out.join("\n"));
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const { positional, lang } = parseArgs(rest);
  const need = (n: number) => {
    if (positional.length !== n) fail(`${command}: expected ${n} argument(s)`, true);
  };
  switch (command) {
    case "decode": {
      need(1);
      const data = await loadGameData(DATA_DIR);
      const run = await readRun(positional[0] ?? "", data);
      console.log(toReadableJson(run, data.texts.en, data));
      return 0;
    }
    case "encode": {
      need(1);
      console.log(await encode(await readRun(positional[0] ?? "", await loadGameData(DATA_DIR))));
      return 0;
    }
    case "validate": {
      need(1);
      const data = await loadGameData(DATA_DIR);
      return validateCommand(await readRun(positional[0] ?? "", data), data, lang);
    }
    case "slots": {
      if (positional.length !== 2 && positional.length !== 3) fail("slots: expected 2 or 3 arguments", true);
      const data = await loadGameData(DATA_DIR);
      return slotsCommand(await readRun(positional[0] ?? "", data), data, lang, positional[1] ?? "", positional[2]);
    }
    default:
      return fail(command === undefined ? "Missing subcommand" : `Unknown subcommand ${command}`, true);
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  if (error instanceof CodecError || error instanceof UsageError || (error as NodeJS.ErrnoException).code === "ENOENT") {
    console.error((error as Error).message);
    process.exitCode = 3;
  } else {
    // Exit 1 means an incomplete run: a failure of the tool itself gets its own code.
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 4;
  }
}
