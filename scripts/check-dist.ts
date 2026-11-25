// Checks a built site (web/dist): nothing is loaded from another site, and everything that must ship is there. Usage: node scripts/check-dist.ts <dist directory>
// Exit 0 and no output when clean; exit 1 with one problem per line on stderr otherwise.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_FILES } from "../web/src/data/loadInBrowser.ts";

/** Sites an `<a href>` may point to (the host itself or any subdomain): the user follows these, the page never loads from them. */
const LINK_HOSTS = ["bg3.wiki", "github.com", "larian.com"];

const EXTERNAL = /^(?:https?:)?\/\//i;

function isAllowedLink(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return LINK_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

interface Reference {
  tag: string;
  attribute: string;
  value: string;
  rel: string;
}

/** Attribute values of the page (src, srcset, href…), with the tag they sit on and its `rel`. */
function htmlReferences(html: string): Reference[] {
  const found: Reference[] = [];
  for (const tag of html.matchAll(/<([a-zA-Z][\w-]*)\b([^>]*)>/g)) {
    const attributes = tag[2] ?? "";
    const rel = /\brel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attributes);
    for (const attribute of attributes.matchAll(/\b(src|srcset|href|poster|data)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
      found.push({
        tag: (tag[1] ?? "").toLowerCase(),
        attribute: (attribute[1] ?? "").toLowerCase(),
        value: attribute[2] ?? attribute[3] ?? attribute[4] ?? "",
        rel: (rel?.[1] ?? rel?.[2] ?? rel?.[3] ?? "").toLowerCase(),
      });
    }
  }
  return found;
}

function checkHtml(name: string, html: string): string[] {
  const problems: string[] = [];
  for (const { tag, attribute, value } of htmlReferences(html)) {
    const urls = attribute === "srcset" ? value.split(",").map((part) => part.trim().split(/\s+/)[0] ?? "") : [value.trim()];
    for (const url of urls) {
      if (!EXTERNAL.test(url)) continue;
      if (tag === "a" && attribute === "href" && isAllowedLink(url)) continue;
      problems.push(`${name}: <${tag} ${attribute}> loads or links to another site: ${url}`);
    }
  }
  return problems;
}

function checkCss(name: string, css: string): string[] {
  const problems: string[] = [];
  const report = (kind: string, url: string) => problems.push(`${name}: CSS ${kind} to another site: ${url}`);
  for (const match of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi)) {
    const url = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (EXTERNAL.test(url)) report("url()", url);
  }
  for (const match of css.matchAll(/@import\s+(?:"([^"]*)"|'([^']*)')/gi)) {
    const url = (match[1] ?? match[2] ?? "").trim();
    if (EXTERNAL.test(url)) report("@import", url);
  }
  return problems;
}

/**
 * In JavaScript only the places that load something count: `fetch(`, `import(`, `importScripts(`, `new Worker(`, `new EventSource(`, `new WebSocket(` and `.src=` with a literal URL.
 * A URL inside another string (an XML namespace, the text of an error message) is not a loaded resource.
 */
function checkJs(name: string, js: string): string[] {
  const problems: string[] = [];
  const literal = `["'\`]((?:https?:)?\\/\\/[^"'\`]*)["'\`]`;
  const calls = new RegExp(`\\b(fetch|import|importScripts|Worker|EventSource|WebSocket|sendBeacon)\\s*\\(\\s*${literal}`, "g");
  for (const match of js.matchAll(calls)) problems.push(`${name}: ${match[1]}() of another site: ${match[2]}`);
  for (const match of js.matchAll(new RegExp(`\\.src\\s*=\\s*${literal}`, "g"))) problems.push(`${name}: .src set to another site: ${match[1]}`);
  return problems;
}

/** Resolves a page reference (`/bg3-planner/assets/app.js`) inside the build, whatever the base: tries the path, then drops leading segments. */
function resolveInBuild(dir: string, url: string): string | null {
  const segments = url.split(/[?#]/)[0]!.split("/").filter((segment) => segment !== "" && segment !== ".");
  for (let skip = 0; skip < segments.length; skip++) {
    const candidate = join(dir, ...segments.slice(skip));
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Problems found in a built site: anything loaded from another site, and anything that must ship but is missing. */
export function checkDist(dir: string): string[] {
  const problems: string[] = [];
  const indexPath = join(dir, "index.html");
  if (!existsSync(indexPath)) {
    problems.push("index.html is missing");
  } else {
    const html = readFileSync(indexPath, "utf8");
    problems.push(...checkHtml("index.html", html));
    const references = htmlReferences(html).filter((reference) => !EXTERNAL.test(reference.value));
    const scripts = references.filter((reference) => reference.tag === "script" && reference.attribute === "src");
    const stylesheets = references.filter((reference) => reference.tag === "link" && reference.attribute === "href" && reference.rel.split(/\s+/).includes("stylesheet"));
    if (scripts.length === 0) problems.push("index.html references no script");
    if (stylesheets.length === 0) problems.push("index.html references no stylesheet");
    for (const { value } of [...scripts, ...stylesheets]) {
      if (resolveInBuild(dir, value) === null) problems.push(`index.html references ${value}, which the build does not contain`);
    }
  }
  for (const file of DATA_FILES) {
    if (!existsSync(join(dir, file))) problems.push(`data file is missing: ${file}`);
  }
  if (existsSync(dir)) {
    for (const path of listFiles(dir)) {
      const name = relative(dir, path);
      if (name === "index.html") continue;
      if (/\.html?$/i.test(name)) problems.push(...checkHtml(name, readFileSync(path, "utf8")));
      else if (/\.css$/i.test(name)) problems.push(...checkCss(name, readFileSync(path, "utf8")));
      else if (/\.(?:m?js|cjs)$/i.test(name)) problems.push(...checkJs(name, readFileSync(path, "utf8")));
    }
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (dir === undefined || process.argv.length > 3) {
    console.error("Usage: node scripts/check-dist.ts <dist directory>");
    process.exitCode = 3;
  } else {
    const problems = checkDist(dir);
    if (problems.length > 0) {
      console.error(problems.join("\n"));
      process.exitCode = 1;
    }
  }
}
