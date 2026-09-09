import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dist");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const common = {
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome150",
  sourcemap: false,
  legalComments: "eof",
  logLevel: "warning",
};

await Promise.all([
  build({ ...common, entryPoints: [resolve(root, "src/background.js")], outfile: resolve(output, "background.js") }),
  build({ ...common, entryPoints: [resolve(root, "src/player-shortcuts.js")], outfile: resolve(output, "player-shortcuts.js") }),
  build({ ...common, entryPoints: [resolve(root, "src/content.js")], outfile: resolve(output, "content.js") }),
  build({ ...common, entryPoints: [resolve(root, "src/sidepanel.js")], outfile: resolve(output, "sidepanel.js") }),
  build({ ...common, entryPoints: [resolve(root, "src/offscreen.js")], outfile: resolve(output, "offscreen.js") }),
]);

await Promise.all([
  cp(resolve(root, "assets"), resolve(output, "assets"), { recursive: true }),
  cp(resolve(root, "_locales"), resolve(output, "_locales"), { recursive: true }),
  cp(resolve(root, "manifest.json"), resolve(output, "manifest.json")),
  cp(resolve(root, "src/sidepanel.html"), resolve(output, "sidepanel.html")),
  cp(resolve(root, "src/sidepanel.css"), resolve(output, "sidepanel.css")),
  cp(resolve(root, "src/offscreen.html"), resolve(output, "offscreen.html")),
]);

const manifest = JSON.parse(await readFile(resolve(output, "manifest.json"), "utf8"));
manifest.version = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")).version;
await writeFile(resolve(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
