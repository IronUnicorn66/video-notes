import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const manifest = JSON.parse(
  await readFile(new URL("../manifest.json", import.meta.url), "utf8"),
);

test("Manifest V3 权限保持在计划范围内", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, [
    "storage",
    "activeTab",
    "scripting",
    "sidePanel",
    "offscreen",
    "downloads",
  ]);
  assert.ok(manifest.content_security_policy.extension_pages.includes("wasm-unsafe-eval"));
});

test("可执行入口全部来自扩展包", () => {
  const serialized = JSON.stringify({
    background: manifest.background.service_worker,
    contentScripts: manifest.content_scripts.flatMap((entry) => entry.js),
    sidePanel: manifest.side_panel.default_path,
  });
  assert.doesNotMatch(serialized, /https?:\/\//);
});

test("构建依赖包含本地 Whisper pthread Worker", async () => {
  const worker = new URL(
    "../node_modules/@transcribe/shout/src/shout/shout.wasm.js",
    import.meta.url,
  );
  await access(worker);
  const source = await readFile(worker, "utf8");
  assert.match(source, /isPthread&&createModule\(\)/);
});

test("隐藏页只通过后台代理使用扩展存储和下载能力", async () => {
  const source = await readFile(new URL("../src/offscreen.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /chrome\.(storage|downloads)/);
  assert.match(source, /OFFSCREEN_STORAGE_GET/);
  assert.match(source, /OFFSCREEN_DOWNLOAD/);
});

test("录音结束持久化期间拒绝覆盖全局录音资源", async () => {
  const offscreen = await readFile(new URL("../src/offscreen.js", import.meta.url), "utf8");
  const background = await readFile(new URL("../src/background.js", import.meta.url), "utf8");
  assert.match(offscreen, /recordingStopping/);
  assert.match(offscreen, /recordingStarting \|\| recordingStopping/);
  assert.match(background, /voiceStartPromise \|\| voiceStopPromise/);
});

test("本地转写使用串行队列并恢复浏览器重启前的待办", async () => {
  const offscreen = await readFile(new URL("../src/offscreen.js", import.meta.url), "utf8");
  const background = await readFile(new URL("../src/background.js", import.meta.url), "utf8");
  assert.match(offscreen, /enqueueTranscription/);
  assert.match(offscreen, /transcriptionTail/);
  assert.match(background, /recoverTransientWhisperState/);
  assert.match(background, /listPendingTranscriptions/);
});
