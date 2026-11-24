// Command line to read, edit and validate run strings. Usage: see USAGE below.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadGameData } from "../src/data/load.ts";
import { bareNameOf } from "../src/data/names.ts";
import type { GameData } from "../src/data/types.ts";
import { alternatives, resolve } from "../src/engine/progression.ts";
import { validate } from "../src/engine/validate.ts";
import { CodecError, decode, encode, toReadableJson } from "../src/plan/codec.ts";
import type { Run } from "../src/plan/model.ts";

const USAGE = `Usage:
  node scripts/run.ts decode <string|file|->            readable JSON with English _name hints
  node scripts/run.ts encode <file.json|->              export string
  node scripts/run.ts validate <string|file|-> [--lang en|fr]
                                                        report; exit 0 valid, 1 incomplete, 2 invalid, 3 unreadable
  node scripts/run.ts slots <string|file|-> <character id> [--lang en|fr]
                                                        open slots with their allowed identifiers`;

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

async function readRun(arg: string): Promise<Run> {
  const { run, warnings } = await decode(readInput(arg));
  for (const warning of warnings) console.error(`warning: ${warning}`);
  return run;
}

function label(id: string, data: GameData, lang: "en" | "fr"): string {
  const name = bareNameOf(data.texts[lang], id);
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

function slotsCommand(run: Run, data: GameData, lang: "en" | "fr", characterId: string): number {
  const character = run.characters.find((c) => c.id === characterId);
  if (character === undefined) fail(`Unknown character id ${JSON.stringify(characterId)}`);
  const { levels } = resolve(character, data);
  const out: string[] = [];
  const undecided = (choices: Record<string, unknown>, slot: string) => {
    const choice = Object.hasOwn(choices, slot) ? choices[slot] : undefined;
    return choice === undefined || choice === "todo";
  };

  for (const level of levels) {
    const choices = character.levels[level.level - 1]?.choices ?? {};
    const before = out.length;
    const add = (slot: string, header: string, allowed: string[]) => {
      out.push(`  ${slot}: ${header}`);
      for (const id of allowed) out.push(`    ${label(id, data, lang)}`);
    };
    out.push(`level ${level.level} (${level.class === "" ? "no class" : label(level.class, data, lang)})`);
    // Rows the game duplicates are alternatives: all are listed until one holds a choice, then only that one.
    const { unused, undecided: openGroups } = alternatives(level, choices);
    for (const group of openGroups) out.push(`  alternative rows (fill one): ${group.join(", ")}`);
    for (const slot of level.slots) {
      if (unused.has(slot.progression)) continue;
      const selector = slot.selector;
      if (selector.function === "AddSpells" || selector.function === "ReplacePassives") continue;
      if ("count" in selector && selector.count === 0) continue;
      if (!undecided(choices, slot.id)) continue;
      const items = data.rules.lists[selector.list]?.items ?? [];
      const count = "count" in selector ? ` count ${selector.count}` : "";
      add(slot.id, `${selector.function}${count}`, items);
    }
    if (level.subclassChoice !== null && undecided(choices, `subclass:${level.class}`)) {
      add(`subclass:${level.class}`, "subclass choice count 1", level.subclassChoice);
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
    if (out.length === before + 1) out.pop();
  }
  console.log(out.length === 0 ? "No open slots" : out.join("\n"));
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
      const run = await readRun(positional[0] ?? "");
      const data = await loadGameData(DATA_DIR);
      console.log(toReadableJson(run, data.texts.en));
      return 0;
    }
    case "encode": {
      need(1);
      console.log(await encode(await readRun(positional[0] ?? "")));
      return 0;
    }
    case "validate": {
      need(1);
      const run = await readRun(positional[0] ?? "");
      return validateCommand(run, await loadGameData(DATA_DIR), lang);
    }
    case "slots": {
      need(2);
      const run = await readRun(positional[0] ?? "");
      return slotsCommand(run, await loadGameData(DATA_DIR), lang, positional[1] ?? "");
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
    throw error;
  }
}
