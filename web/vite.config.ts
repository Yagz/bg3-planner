import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import { DATA_FILES } from "./src/data/loadInBrowser.ts";

const BASE = "/bg3-planner/";
const REPO = fileURLToPath(new URL("..", import.meta.url));

/** Licence texts of the embedded fonts (SIL Open Font License 1.1), shipped beside the font files. */
const FONT_LICENCES: Record<string, string> = {
  "fonts/OFL-marcellus.txt": "node_modules/@fontsource/marcellus/LICENSE",
  "fonts/OFL-source-sans-3.txt": "node_modules/@fontsource-variable/source-sans-3/LICENSE",
};

/** Serves the game data files in development and copies them (and the font licences) into the build output, at the paths the site fetches. */
function gameData(): Plugin {
  const files = new Set<string>(DATA_FILES);
  return {
    name: "bg3-game-data",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = (request.url ?? "").split("?")[0] ?? "";
        const file = path.startsWith(BASE) ? path.slice(BASE.length) : "";
        if (!files.has(file)) return next();
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.end(readFileSync(join(REPO, file)));
      });
    },
    generateBundle() {
      for (const file of DATA_FILES) this.emitFile({ type: "asset", fileName: file, source: readFileSync(join(REPO, file)) });
      for (const [file, source] of Object.entries(FONT_LICENCES)) this.emitFile({ type: "asset", fileName: file, source: readFileSync(join(REPO, source)) });
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: BASE,
  plugins: [react(), gameData()],
  build: { outDir: "dist", emptyOutDir: true },
});
