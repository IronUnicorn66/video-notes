import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { createZip } from "../src/core/zip.js";

const execute = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const artifacts = resolve(root, "artifacts");

await execute(process.execPath, [resolve(root, "scripts/build-extension.mjs")], { cwd: root });

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  }));
  return nested.flat();
}

const files = await Promise.all((await filesBelow(dist)).map(async (path) => ({
  name: relative(dist, path).replaceAll("\\", "/"),
  data: new Uint8Array(await readFile(path)),
})));
const version = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")).version;
await mkdir(artifacts, { recursive: true });
await writeFile(resolve(artifacts, `video-notes-edge-${version}.zip`), createZip(files));

