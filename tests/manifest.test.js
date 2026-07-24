import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const manifest = JSON.parse(
  await readFile(new URL("../manifest.json", import.meta.url), "utf8"),
);
const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

test("Manifest V3 权限保持在计划范围内", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, packageJson.version);
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

test("播放器截图权限保持可选并由用户单独授权", () => {
  assert.ok(manifest.optional_host_permissions.includes("<all_urls>"));
  assert.ok(!manifest.host_permissions.includes("<all_urls>"));
});

test("Edge MV3 扩展页 CSP 只允许打包内 Worker", () => {
  assert.equal(
    manifest.content_security_policy.extension_pages,
    "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; worker-src 'self'",
  );
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

test("侧栏提供可见的截图和麦克风授权入口", async () => {
  const html = await readFile(new URL("../src/sidepanel.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/sidepanel.js", import.meta.url), "utf8");
  assert.match(html, /id="screenshot-permission-button"/);
  assert.match(html, /id="microphone-permission-button"/);
  assert.match(source, /chrome\.permissions\.request/);
  assert.match(source, /navigator\.mediaDevices\.getUserMedia/);
});

test("页面快捷键在麦克风未初始化时给出可见提示", async () => {
  const content = await readFile(new URL("../src/content.js", import.meta.url), "utf8");
  const background = await readFile(new URL("../src/background.js", import.meta.url), "utf8");
  const offscreen = await readFile(new URL("../src/offscreen.js", import.meta.url), "utf8");
  assert.match(content, /showShortcutError\(error\.message\)/);
  assert.match(content, /document\.fullscreenElement \?\? document\.documentElement/);
  assert.match(background, /microphoneReady/);
  assert.match(background, /GET_MICROPHONE_PERMISSION/);
  assert.match(offscreen, /navigator\.permissions\.query\(\{ name: "microphone" \}\)/);
  assert.match(background, /请先在侧栏的权限设置中授权麦克风/);
});
