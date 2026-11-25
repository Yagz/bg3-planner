import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DATA_FILES } from "../../web/src/data/loadInBrowser.ts";
import { checkDist } from "../../scripts/check-dist.ts";

let dir: string;

function put(file: string, content: string): void {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), content);
}

const INDEX = `<!doctype html><html><head><link rel="icon" href="data:,"><script type="module" crossorigin src="/bg3-planner/assets/app.js"></script><link rel="stylesheet" crossorigin href="/bg3-planner/assets/app.css"></head><body><div id="root"></div></body></html>`;

/** A minimal clean build: index, one script, one stylesheet, every data file. */
function cleanBuild(): void {
  put("index.html", INDEX);
  put("assets/app.js", `console.log("hello");`);
  put("assets/app.css", `body{background:url(data:image/png;base64,AAAA)}`);
  for (const file of DATA_FILES) put(file, "{}");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "check-dist-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("checkDist", () => {
  it("passes a clean build", () => {
    cleanBuild();
    expect(checkDist(dir)).toEqual([]);
  });

  it("reports an external script in the page", () => {
    cleanBuild();
    put("index.html", INDEX.replace("</head>", `<script src="https://cdn.example.com/x.js"></script></head>`));
    const problems = checkDist(dir);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("index.html");
    expect(problems[0]).toContain("https://cdn.example.com/x.js");
  });

  it("reports an external stylesheet link and a protocol-relative one", () => {
    cleanBuild();
    put("index.html", INDEX.replace("</head>", `<link rel="stylesheet" href="//fonts.example.com/a.css"></head>`));
    expect(checkDist(dir).join("\n")).toContain("//fonts.example.com/a.css");
  });

  it("reports a CSS url() and @import to another site, quoted or not", () => {
    cleanBuild();
    put("assets/app.css", `@font-face{src:url(https://fonts.example.com/a.woff2)}\n@import "https://fonts.example.com/b.css";\n@import url('http://x.example.com/c.css');`);
    const text = checkDist(dir).join("\n");
    expect(text).toContain("https://fonts.example.com/a.woff2");
    expect(text).toContain("https://fonts.example.com/b.css");
    expect(text).toContain("http://x.example.com/c.css");
  });

  it("reports fetch(), import() and a script src assignment to another site in JS", () => {
    cleanBuild();
    put("assets/app.js", `fetch("https://api.example.com/a");import("https://cdn.example.com/m.js");e.src="https://cdn.example.com/s.js";`);
    const problems = checkDist(dir);
    expect(problems).toHaveLength(3);
  });

  it("does not report URL strings that are not loaded (namespaces, error text)", () => {
    cleanBuild();
    put("assets/app.js", `var a="http://www.w3.org/2000/svg",b="https://react.dev/errors/"+c;`);
    expect(checkDist(dir)).toEqual([]);
  });

  it("allows links to bg3.wiki, GitHub and Larian in an <a href>, and not other sites", () => {
    cleanBuild();
    put("index.html", INDEX.replace("<div", `<a href="https://bg3.wiki/wiki/Gale">a</a><a href="https://github.com/Yagz/bg3-planner">b</a><a href="https://www.larian.com/">c</a><a href="https://evil.example.com/">d</a><div`));
    const problems = checkDist(dir);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("https://evil.example.com/");
  });

  it("reports a missing data file", () => {
    cleanBuild();
    rmSync(join(dir, DATA_FILES[2]));
    const problems = checkDist(dir);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(DATA_FILES[2]);
  });

  it("reports a missing index.html", () => {
    cleanBuild();
    rmSync(join(dir, "index.html"));
    expect(checkDist(dir).join("\n")).toContain("index.html");
  });

  it("reports a script or stylesheet the page references but the build lacks", () => {
    cleanBuild();
    rmSync(join(dir, "assets/app.js"));
    rmSync(join(dir, "assets/app.css"));
    const text = checkDist(dir).join("\n");
    expect(text).toContain("assets/app.js");
    expect(text).toContain("assets/app.css");
  });

  it("reports a page that references no script or no stylesheet", () => {
    cleanBuild();
    put("index.html", `<!doctype html><html><body></body></html>`);
    const text = checkDist(dir).join("\n");
    expect(text).toMatch(/script/);
    expect(text).toMatch(/stylesheet/);
  });
});

describe("checkDist inline content and static imports", () => {
  it("scans <style> and <script> bodies and style attributes of the page and of any other HTML file", () => {
    cleanBuild();
    const inline = `<style>@import url(https://fonts.example.com/a.css);</style><style>a{background:url('https://img.example.com/b.png')}</style><script>fetch("https://api.example.com/c")</script><p style="background:url(https://img.example.com/d.png)">x</p>`;
    put("index.html", INDEX.replace("<div", `${inline}<div`));
    put("other.html", `<!doctype html>${inline}`);
    const text = checkDist(dir).join("\n");
    for (const file of ["index.html", "other.html"]) {
      for (const url of ["fonts.example.com/a.css", "img.example.com/b.png", "api.example.com/c", "img.example.com/d.png"]) {
        expect(text.split("\n").some((line) => line.startsWith(`${file} `) && line.includes(url))).toBe(true);
      }
    }
  });

  it("does not report inline code without an external load", () => {
    cleanBuild();
    put("index.html", INDEX.replace("<div", `<style>a{color:red}</style><script>var x="https://react.dev/errors/"</script><p style="color:red">x</p><div`));
    expect(checkDist(dir)).toEqual([]);
  });

  it("reports static imports of another site, spaced or minified", () => {
    cleanBuild();
    put("assets/app.js", `import x from "https://a.example.com/1.js";import"https://b.example.com/2.js";export*from"https://c.example.com/3.js";import{y}from'//d.example.com/4.js';`);
    const text = checkDist(dir).join("\n");
    for (const host of ["a", "b", "c", "d"]) expect(text).toContain(`${host}.example.com`);
  });

  it("matches URLs case-insensitively in JS", () => {
    cleanBuild();
    put("assets/app.js", `fetch("HTTPS://api.example.com/a")`);
    expect(checkDist(dir)).toHaveLength(1);
  });
});

describe("check-dist command", () => {
  it("prints nothing and exits 0 on a clean build, lists problems and exits 1 otherwise", () => {
    const script = join(import.meta.dirname, "../../scripts/check-dist.ts");
    cleanBuild();
    const ok = spawnSync("node", [script, dir], { encoding: "utf8" });
    expect(ok.status).toBe(0);
    expect(ok.stdout + ok.stderr).toBe("");
    rmSync(join(dir, DATA_FILES[0]));
    const bad = spawnSync("node", [script, dir], { encoding: "utf8" });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain(DATA_FILES[0]);
  });

  it("checks when run through a symlink", () => {
    const script = join(import.meta.dirname, "../../scripts/check-dist.ts");
    cleanBuild();
    rmSync(join(dir, DATA_FILES[0]));
    const link = join(dir, "..", `check-dist-link-${process.pid}.ts`);
    symlinkSync(script, link);
    try {
      const result = spawnSync("node", [link, dir], { encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(DATA_FILES[0]);
    } finally {
      rmSync(link, { force: true });
    }
  });
});
