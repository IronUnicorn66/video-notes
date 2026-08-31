import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";

import {
  createNoteHistoryCommandRouter,
  persistRecordedNote,
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
  assert.equal(manifest.version, "1.0.9");
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
    "在 YouTube 和哔哩哔哩课程中用文字或按住说话快速标记，导出带截图、字幕和录音的 Markdown。",
  );
  assert.equal(zhCnMessages.actionTitle?.message, "打开视频笔记");
  assert.equal(enMessages.extensionName?.message, "Video Notes");
  assert.match(enMessages.extensionDescription?.message ?? "", /YouTube and Bilibili/);
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
  const voiceStop = background.slice(
    background.indexOf("async function stopVoiceUnlocked"),
    background.indexOf("async function finishVoiceUi"),
  );
  const voiceSuccess = voiceStop.slice(
    voiceStop.indexOf("const note = await repository.getNote(result.noteId)"),
    voiceStop.indexOf("if (result.whisperReady)"),
  );
  const recordingStop = offscreen.slice(
    offscreen.indexOf("async function stopRecordingCore"),
    offscreen.indexOf("async function abortRecording"),
  );

  assert.match(
    messageHandler,
    /if \(isNoteHistoryCommand\(message\.type\)\) \{\s+const request = await noteHistoryRequest\(message, sender\);\s+return noteHistoryCommandRouter\(message, request\)/,
  );
  assert.match(background, /sidePanelRequestTabIdForSender/);
  assert.match(voiceStop, /repository\.commitSavedNote\(note\.id/);
  assert.doesNotMatch(voiceSuccess, /repository\.putNote\(/);
  assert.match(recordingStop, /await persistRecordedNote\(\{/);
  assert.doesNotMatch(recordingStop, /repository\.updateNote\(noteId/);
});

test("录音保存先持久化音频并只提交一次可撤销新增", async () => {
  const repository = new VideoNotesRepository({
    databaseName: `voice-history-${crypto.randomUUID()}`,
    indexedDB,
    IDBKeyRange,
  });
  await repository.putNote({
    id: "voice",
    sessionId: "youtube:voice",
    status: "recording",
    createdAt: 1,
  });

  const saved = await persistRecordedNote({
    repository,
    noteId: "voice",
    audio: new Blob(["voice"], { type: "audio/webm" }),
    audioKey: "audio/voice",
    transcriptionStatus: "disabled",
    now: 10,
  });
  assert.equal(saved.status, "saved");
  assert.equal(saved.audioKey, "audio/voice");
  assert.equal(await (await repository.getAsset("audio/voice")).text(), "voice");
  assert.deepEqual(await repository.getNoteHistoryState("youtube:voice"), {
    canUndo: true,
    canRedo: false,
  });

  await repository.undoNoteAction("youtube:voice", 20);
  assert.deepEqual(await repository.listNotes("youtube:voice"), []);
  assert.equal(await repository.undoNoteAction("youtube:voice", 30), null);
  await repository.destroy();
});

test("录音提交失败时删除未被笔记引用的音频资产", async () => {
  const repository = new VideoNotesRepository({
    databaseName: `voice-history-failure-${crypto.randomUUID()}`,
    indexedDB,
    IDBKeyRange,
  });

  await assert.rejects(
    persistRecordedNote({
      repository,
      noteId: "missing",
      audio: new Blob(["voice"], { type: "audio/webm" }),
      audioKey: "audio/missing",
      transcriptionStatus: "disabled",
      now: 10,
    }),
    /标记不存在/,
  );
  assert.equal(await repository.getAsset("audio/missing"), undefined);
  await repository.destroy();
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
  assert.ok(manifest.content_security_policy.extension_pages.includes("wasm-unsafe-eval"));
});

test("播放器截图权限保持可选并由用户单独授权", () => {
  assert.ok(manifest.optional_host_permissions.includes("<all_urls>"));
  assert.ok(!manifest.host_permissions.includes("<all_urls>"));
});

test("模型下载主机权限保持可选并覆盖固定模型源", () => {
  assert.deepEqual(manifest.optional_host_permissions.slice(1), [
    "https://huggingface.co/*",
    "https://cdn-lfs.hf.co/*",
    "https://*.xethub.hf.co/*",
  ]);
});

test("Edge MV3 扩展页 CSP 只允许打包内 Worker", () => {
  assert.equal(
    manifest.content_security_policy.extension_pages,
    "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; worker-src 'self'",
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
  assert.match(serialized, /content\.js/);
  assert.match(serialized, /sidepanel\.html/);

  const build = await readFile(new URL("../scripts/build-extension.mjs", import.meta.url), "utf8");
  for (const entry of [
    "background.js",
    "content.js",
    "sidepanel.js",
    "offscreen.js",
    "microphone-permission.js",
  ]) {
    assert.ok(build.includes(`src/${entry}`));
  }
});

test("侧栏只由受支持的视频标签启用", async () => {
  const background = await readFile(new URL("../dist/background.js", import.meta.url), "utf8");

  assert.equal(manifest.side_panel.default_path, "sidepanel.html");
  assert.match(background, /chrome\.sidePanel\.setOptions/);
  assert.ok(!manifest.permissions.includes("tabs"));
  assert.ok(!manifest.host_permissions.includes("<all_urls>"));
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

test("首次麦克风授权从普通扩展页发起", async () => {
  const sidepanel = await readFile(new URL("../src/sidepanel.js", import.meta.url), "utf8");
  const permissionHtml = await readFile(
    new URL("../src/microphone-permission.html", import.meta.url),
    "utf8",
  ).catch(() => "");
  const permissionSource = await readFile(
    new URL("../src/microphone-permission.js", import.meta.url),
    "utf8",
  ).catch(() => "");
  const build = await readFile(new URL("../scripts/build-extension.mjs", import.meta.url), "utf8");

  assert.doesNotMatch(sidepanel, /navigator\.mediaDevices\.getUserMedia/);
  assert.doesNotMatch(sidepanel, /chrome\.tabs\.create/);
  assert.match(sidepanel, /OPEN_MICROPHONE_PERMISSION_PAGE/);
  assert.match(permissionHtml, /id="grant-microphone-button"/);
  assert.match(permissionSource, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(build, /microphone-permission\.html/);
});

test("页面快捷键在麦克风未初始化时打开授权页并给出可见提示", async () => {
  const content = await readFile(new URL("../src/content.js", import.meta.url), "utf8");
  const background = await readFile(new URL("../src/background.js", import.meta.url), "utf8");
  const offscreen = await readFile(new URL("../src/offscreen.js", import.meta.url), "utf8");
  assert.match(content, /showShortcutError\(error\.message\)/);
  assert.match(content, /document\.fullscreenElement \?\? document\.documentElement/);
  assert.match(background, /microphoneReady/);
  assert.match(background, /GET_MICROPHONE_PERMISSION/);
  assert.match(offscreen, /navigator\.permissions\.query\(\{ name: "microphone" \}\)/);
  assert.match(background, /openMicrophonePermissionPage/);
  assert.match(background, /microphone-permission\.html/);
  assert.match(background, /chrome\.runtime\.getContexts/);
  assert.match(background, /chrome\.tabs\.update/);
  assert.match(background, /请在新页面完成麦克风授权/);
});

test("录音启动权限失败时先释放资源再打开授权页", async () => {
  const background = await readFile(new URL("../src/background.js", import.meta.url), "utf8");
  const catchStart = background.indexOf(
    "const permissionError = isMicrophonePermissionError(error)",
    background.indexOf("async function startVoiceUnlocked"),
  );
  const catchEnd = background.indexOf("async function stopVoice", catchStart);
  const failureCleanup = background.slice(catchStart, catchEnd);

  assert.ok(failureCleanup.indexOf("activeVoiceNote = null") >= 0);
  assert.ok(
    failureCleanup.indexOf("activeVoiceNote = null")
      < failureCleanup.lastIndexOf("openMicrophonePermissionPage"),
  );
  assert.match(failureCleanup, /openMicrophonePermissionPage\(tab\)\.catch/);
});

test("麦克风授权成功后返回发起授权的网课标签", async () => {
  const background = await readFile(new URL("../src/background.js", import.meta.url), "utf8");
  const permissionSource = await readFile(
    new URL("../src/microphone-permission.js", import.meta.url),
    "utf8",
  );
  const navigation = await readFile(
    new URL("../src/core/microphone-navigation.js", import.meta.url),
    "utf8",
  );

  assert.match(background, /createMicrophoneNavigation/);
  assert.match(background, /storageSession: chrome\.storage\.session/);
  assert.match(background, /microphoneNavigation\.rememberSource\(returnTab\)/);
  assert.match(background, /MICROPHONE_PERMISSION_GRANTED/);
  assert.match(background, /microphoneNavigation\.returnToSource\(\)/);
  assert.match(navigation, /tabs\.update\(returnTabId, \{ active: true \}\)/);
  assert.match(navigation, /windows\.update\(tab\.windowId, \{ focused: true \}\)/);
  assert.match(permissionSource, /MICROPHONE_PERMISSION_GRANTED/);
  assert.ok(
    permissionSource.indexOf("MICROPHONE_PERMISSION_GRANTED")
      < permissionSource.lastIndexOf("closePermissionTab"),
  );
});
