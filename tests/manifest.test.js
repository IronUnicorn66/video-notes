import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";

import {
  createNoteHistoryCommandRouter,
} from "../src/core/note-history-commands.js";
import { VideoNotesRepository } from "../src/core/storage.js";

const execFileAsync = promisify(execFile);
await execFileAsync(process.execPath, ["scripts/build-extension.mjs"], {
  cwd: new URL("../", import.meta.url),
});

const manifest = JSON.parse(
  await readFile(new URL("../manifest.json", import.meta.url), "utf8"),
);
const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const packageLock = JSON.parse(
  await readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
);
const zhCnMessages = JSON.parse(
  await readFile(
    new URL("../_locales/zh_CN/messages.json", import.meta.url),
    "utf8",
  ).catch(() => "{}"),
);
const enMessages = JSON.parse(
  await readFile(
    new URL("../_locales/en/messages.json", import.meta.url),
    "utf8",
  ).catch(() => "{}"),
);

test("发布版本在 Manifest、包元数据和锁文件中保持一致", () => {
  assert.equal(manifest.version, "1.0.41");
  assert.equal(packageJson.version, manifest.version);
  assert.equal(packageLock.version, manifest.version);
  assert.equal(packageLock.packages[""].version, manifest.version);
});

test("Edge 发布包声明中英文和公开主页", async () => {
  assert.equal(manifest.default_locale, "zh_CN");
  assert.equal(manifest.name, "__MSG_extensionName__");
  assert.equal(manifest.description, "__MSG_extensionDescription__");
  assert.equal(manifest.action.default_title, "__MSG_actionTitle__");
  assert.equal(
    manifest.homepage_url,
    "https://ironunicorn66.github.io/video-notes/",
  );
  assert.equal(zhCnMessages.extensionName?.message, "视频笔记");
  assert.equal(
    zhCnMessages.extensionDescription?.message,
    "在 YouTube 和哔哩哔哩课程旁阅读与本地翻译字幕，记录文字和截图，并导出带原文字幕时间轴的笔记。",
  );
  assert.equal(zhCnMessages.actionTitle?.message, "打开视频笔记");
  assert.equal(enMessages.extensionName?.message, "Video Notes");
  assert.equal(
    enMessages.extensionDescription?.message,
    "Read and locally translate YouTube and Bilibili subtitles, capture notes and screenshots, and export original timed transcripts.",
  );
  assert.ok(zhCnMessages.extensionDescription.message.length <= 132);
  assert.ok(enMessages.extensionDescription.message.length <= 132);
  assert.equal(enMessages.actionTitle?.message, "Open Video Notes");
  const builtMessages = JSON.parse(
    await readFile(
      new URL("../dist/_locales/zh_CN/messages.json", import.meta.url),
      "utf8",
    ).catch(() => "{}"),
  );
  assert.deepEqual(builtMessages, zhCnMessages);
  const builtEnMessages = JSON.parse(
    await readFile(
      new URL("../dist/_locales/en/messages.json", import.meta.url),
      "utf8",
    ).catch(() => "{}"),
  );
  assert.deepEqual(builtEnMessages, enMessages);
});

test("公开文档提供一致的主页、隐私和支持入口", async () => {
  const [readme, listing, privacy, license] = await Promise.all([
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/STORE_LISTING.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/PRIVACY.md", import.meta.url), "utf8"),
    readFile(new URL("../LICENSE", import.meta.url), "utf8").catch(() => ""),
  ]);
  const homepage = "https://ironunicorn66.github.io/video-notes/";
  const privacyUrl = `${homepage}privacy/`;
  const supportUrl = "https://github.com/IronUnicorn66/video-notes/issues";

  assert.ok(readme.includes(`${homepage}en/`));
  assert.ok(readme.includes(`${homepage}en/privacy/`));
  assert.ok(readme.includes(supportUrl));
  assert.ok(listing.includes(homepage));
  assert.ok(listing.includes(privacyUrl));
  assert.ok(listing.includes(supportUrl));
  assert.ok(privacy.includes(supportUrl));
  assert.match(license, /MIT License/);
  for (const permission of manifest.permissions) {
    assert.ok(listing.includes(`\`${permission}\``));
  }
});

test("后台笔记命令基于当前页面会话路由历史操作", async () => {
  const repository = new VideoNotesRepository({
    databaseName: `background-history-${crypto.randomUUID()}`,
    indexedDB,
    IDBKeyRange,
  });
  const context = { sessionId: "youtube:one", title: "第一课" };
  let releasedNote = null;
  const route = createNoteHistoryCommandRouter({
    repository,
    getCurrentContext: async () => context,
    onTypedNoteCommitted: async (note) => {
      releasedNote = note;
    },
  });
  await repository.putNote({
    id: "typed",
    sessionId: context.sessionId,
    status: "draft",
    body: "",
    userEditVersion: 0,
    createdAt: 1,
  });

  const committed = await route({ type: "COMMIT_TYPED_NOTE", noteId: "typed", body: "课堂重点" });
  assert.equal(committed.note.status, "saved");
  assert.equal(committed.note.body, "课堂重点");
  assert.equal(releasedNote.id, "typed");
  assert.equal(releasedNote.status, "saved");
  assert.equal((await route({ type: "UPDATE_NOTE_BODY", noteId: "typed", body: "修订重点" })).note.body, "修订重点");
  assert.equal((await route({
    type: "UPDATE_NOTE_SUBTITLE",
    noteId: "typed",
    subtitleContext: "字幕重点",
  })).note.subtitleContext, "字幕重点");

  const active = await route({ type: "GET_ACTIVE_STATE" });
  assert.deepEqual(active.context, context);
  assert.deepEqual(active.notes.map((note) => note.id), ["typed"]);
  assert.deepEqual(active.history, { canUndo: true, canRedo: false });

  await route({
    type: "DELETE_NOTE",
    noteId: "typed",
    sessionId: context.sessionId,
  });
  assert.deepEqual(await repository.listNotes(context.sessionId), []);
  await route({ type: "UNDO_NOTE_ACTION", sessionId: context.sessionId });
  assert.equal((await repository.listNotes(context.sessionId))[0].id, "typed");

  await repository.putNote({
    id: "other-session-note",
    sessionId: "youtube:other",
    status: "saved",
    body: "其他课程",
    createdAt: 2,
  });
  await assert.rejects(
    route({
      type: "DELETE_NOTE",
      noteId: "other-session-note",
      sessionId: context.sessionId,
    }),
    /不属于当前页面会话/,
  );
  await assert.rejects(
    route({
      type: "DELETE_NOTE",
      noteId: "typed",
      sessionId: "youtube:other",
    }),
    /当前页面会话不匹配/,
  );
  assert.equal((await repository.getNote("other-session-note")).deletedAt, undefined);
  await route({ type: "REDO_NOTE_ACTION", sessionId: context.sessionId });
  assert.deepEqual(await repository.listNotes(context.sessionId), []);
  await route({ type: "UNDO_NOTE_ACTION", sessionId: context.sessionId });
  await route({ type: "CLEAR_SESSION_NOTES", sessionId: context.sessionId });
  assert.deepEqual(await repository.listNotes(context.sessionId), []);
  await route({ type: "UNDO_NOTE_ACTION", sessionId: context.sessionId });
  assert.equal((await repository.listNotes(context.sessionId))[0].id, "typed");

  for (const type of ["CLEAR_SESSION_NOTES", "UNDO_NOTE_ACTION", "REDO_NOTE_ACTION"]) {
    await assert.rejects(
      route({ type, sessionId: "youtube:other" }),
      /当前页面会话不匹配/,
    );
  }
  assert.equal((await repository.listNotes(context.sessionId))[0].id, "typed");
  await repository.destroy();
});

test("后台和隐藏页通过历史提交边界保存笔记", async () => {
  const background = await readFile(new URL("../src/background.js", import.meta.url), "utf8");
  const offscreen = await readFile(new URL("../src/offscreen.js", import.meta.url), "utf8");
  const messageHandler = background.slice(
    background.indexOf("async function handleMessage"),
    background.indexOf("function assertOffscreenSender"),
  );
  assert.match(
    messageHandler,
    /if \(isNoteHistoryCommand\(message\.type\)\) \{\s+const request = await noteHistoryRequest\(message, sender\);\s+const result = await noteHistoryCommandRouter\(message, request\)/,
  );
  assert.match(messageHandler, /type: "NOTES_CHANGED",\s+tabId: request\.tabId/);
  assert.match(background, /sidePanelRequestTabIdForSender/);
});

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
  assert.doesNotMatch(manifest.content_security_policy.extension_pages, /wasm-unsafe-eval/);
  assert.deepEqual(manifest.optional_host_permissions, ["<all_urls>"]);
});

test("播放器截图权限保持可选并由用户单独授权", () => {
  assert.ok(manifest.optional_host_permissions.includes("<all_urls>"));
  assert.ok(!manifest.host_permissions.includes("<all_urls>"));
});

test("Edge MV3 扩展页 CSP 只允许打包内 Worker", () => {
  assert.equal(
    manifest.content_security_policy.extension_pages,
    "script-src 'self'; object-src 'self'",
  );
});

test("所有本地执行代码入口都来自扩展包", async () => {
  const serialized = JSON.stringify({
    background: manifest.background.service_worker,
    contentScripts: manifest.content_scripts.flatMap((entry) => entry.js),
    sidePanel: manifest.side_panel.default_path,
  });
  assert.doesNotMatch(serialized, /https?:\/\//);
  assert.match(serialized, /background\.js/);
  assert.match(serialized, /player-shortcuts\.js/);
  assert.match(serialized, /content\.js/);
  assert.match(serialized, /sidepanel\.html/);

  const build = await readFile(new URL("../scripts/build-extension.mjs", import.meta.url), "utf8");
  for (const entry of [
    "background.js",
    "player-shortcuts.js",
    "content.js",
    "sidepanel.js",
    "offscreen.js",
  ]) {
    assert.ok(build.includes(`src/${entry}`));
  }
});

test("播放器快捷键在网站脚本前注入且普通内容脚本保持空闲时加载", () => {
  const playerShortcuts = manifest.content_scripts.find((entry) => (
    entry.js.includes("player-shortcuts.js")
  ));
  const content = manifest.content_scripts.find((entry) => entry.js.includes("content.js"));

  assert.equal(playerShortcuts.run_at, "document_start");
  assert.equal(content.run_at, "document_idle");
  assert.deepEqual(playerShortcuts.matches, content.matches);
});

test("侧栏只在视频标签启用且不扩大网站访问权限", async () => {
  const background = await readFile(new URL("../src/background.js", import.meta.url), "utf8");

  assert.equal(manifest.side_panel.default_path, "sidepanel.html");
  assert.match(background, /createExistingSidePanelOptionsConfigurator/);
  assert.match(background, /chrome\.tabs\.onCreated\.addListener/);
  assert.match(background, /changeInfo\.url \|\| changeInfo\.status === "complete"/);
  assert.doesNotMatch(background, /chrome\.sidePanel\.open/);
  assert.ok(!manifest.permissions.includes("tabs"));
  assert.ok(!manifest.host_permissions.includes("<all_urls>"));
});

test("后台每次加载都重新启用工具栏图标打开侧栏", async () => {
  const background = await readFile(new URL("../src/background.js", import.meta.url), "utf8");
  const behaviorCall = /chrome\.sidePanel\s*\.setPanelBehavior\(\{ openPanelOnActionClick: true \}\)/g;
  const behaviorIndex = background.search(behaviorCall);
  const configureIndex = background.indexOf("void configureExistingSidePanelOptions()");
  const installedListenerIndex = background.indexOf("chrome.runtime.onInstalled.addListener");

  assert.equal((background.match(behaviorCall) ?? []).length, 1);
  assert.ok(behaviorIndex >= 0 && behaviorIndex < installedListenerIndex);
  assert.ok(configureIndex >= 0 && configureIndex < installedListenerIndex);
  assert.doesNotMatch(background, /chrome\.runtime\.onStartup\.addListener/);
  assert.doesNotMatch(background, /chrome\.action\.onClicked|chrome\.sidePanel\.open/);
});

test("隐藏页只通过后台代理使用扩展存储和下载能力", async () => {
  const source = await readFile(new URL("../src/offscreen.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /chrome\.(storage|downloads)/);
  assert.doesNotMatch(source, /OFFSCREEN_STORAGE_GET|USER_MEDIA|MediaRecorder/);
  assert.match(source, /OFFSCREEN_DOWNLOAD/);
});

test("侧栏提供截图预览对话框和音频样式入口", async () => {
  const html = await readFile(new URL("../src/sidepanel.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/sidepanel.css", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/sidepanel.js", import.meta.url), "utf8");
  assert.match(html, /<dialog id="screenshot-dialog"/);
  assert.match(html, /id="screenshot-dialog-close"/);
  assert.match(html, /id="screenshot-dialog-image"/);
  assert.match(source, /note-audio/);
  assert.match(source, /getBoundingClientRect/);
  assert.match(css, /\.note-audio/);
});

test("构建产物包含侧栏历史工具栏和确认框", async () => {
  const html = await readFile(new URL("../dist/sidepanel.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../dist/sidepanel.js", import.meta.url), "utf8");

  for (const id of [
    "undo-button",
    "redo-button",
    "clear-button",
    "history-confirm-dialog",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(source, /CLEAR_SESSION_NOTES/);
  assert.match(source, /DELETE_NOTE/);
  assert.match(source, /UNDO_NOTE_ACTION/);
  assert.match(source, /REDO_NOTE_ACTION/);
});
