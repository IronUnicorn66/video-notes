import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { WHISPER_MODEL } from "../src/core/model-config.js";

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
  build({ ...common, entryPoints: [resolve(root, "src/content.js")], outfile: resolve(output, "content.js") }),
  build({ ...common, entryPoints: [resolve(root, "src/sidepanel.js")], outfile: resolve(output, "sidepanel.js") }),
  build({ ...common, entryPoints: [resolve(root, "src/microphone-permission.js")], outfile: resolve(output, "microphone-permission.js") }),
  build({ ...common, entryPoints: [resolve(root, "src/offscreen.js")], outfile: resolve(output, "offscreen.js") }),
]);

if (process.env.VIDEO_NOTES_BUNDLED_MODEL) {
  const modelPath = resolve(process.env.VIDEO_NOTES_BUNDLED_MODEL);
  const modelStat = await stat(modelPath);
  if (modelStat.size !== WHISPER_MODEL.size) {
    throw new Error(`内置模型大小无效：${modelStat.size}`);
  }
  const modelBytes = await readFile(modelPath);
  const digest = createHash("sha256").update(modelBytes).digest("hex");
  if (digest !== WHISPER_MODEL.sha256) throw new Error("内置模型 SHA-256 无效");
  await mkdir(resolve(output, "models"), { recursive: true });
  await writeFile(resolve(output, "models", WHISPER_MODEL.filename), modelBytes);
}

await Promise.all([
  cp(resolve(root, "assets"), resolve(output, "assets"), { recursive: true }),
  cp(resolve(root, "manifest.json"), resolve(output, "manifest.json")),
  cp(resolve(root, "src/sidepanel.html"), resolve(output, "sidepanel.html")),
  cp(resolve(root, "src/sidepanel.css"), resolve(output, "sidepanel.css")),
  cp(resolve(root, "src/microphone-permission.html"), resolve(output, "microphone-permission.html")),
  cp(resolve(root, "src/microphone-permission.css"), resolve(output, "microphone-permission.css")),
  cp(resolve(root, "src/offscreen.html"), resolve(output, "offscreen.html")),
  cp(
    resolve(root, "node_modules/@transcribe/shout/src/shout/shout.wasm.js"),
    resolve(output, "shout-worker.js"),
  ),
]);

const manifest = JSON.parse(await readFile(resolve(output, "manifest.json"), "utf8"));
manifest.version = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")).version;
await writeFile(resolve(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
