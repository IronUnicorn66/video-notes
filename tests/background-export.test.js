import assert from "node:assert/strict";
import test from "node:test";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { VideoNotesRepository } from "../src/core/storage.js";

// Exercise the real background message route with browser APIs supplied by the test.
test("后台导出共用进行中的字幕读取，支持缓存、无批注和错误会话拒绝", { timeout: 2000 }, async () => {
  const extensionUrl = "chrome-extension://test/";
  const tab = { id: 7, windowId: 1, url: "https://www.youtube.com/watch?v=lesson" };
  const context = { platform: "youtube", sessionId: "youtube:lesson", videoId: "lesson", part: 1,
    canonicalUrl: tab.url, title: "Lesson" };
  const transcript = { ok: true, source: "youtube-caption-track", videoId: "lesson", languageCode: "en",
    cues: [{ startMs: 1250, endMs: 2500, text: "English source" }] };
  const sender = { id: "test", url: `${extensionUrl}sidepanel.html`, documentId: "panel" };
  let listener;
  let readCount = 0;
  let offscreenCount = 0;
  const exports = [];
  let finishRead;
  const pendingRead = new Promise((resolve) => { finishRead = resolve; });
  let markReadStarted;
  const readStarted = new Promise((resolve) => { markReadStarted = resolve; });
  const event = () => ({ addListener() {} });
  const previous = { chrome: globalThis.chrome, indexedDB: globalThis.indexedDB, IDBKeyRange: globalThis.IDBKeyRange };
  Object.assign(globalThis, { indexedDB, IDBKeyRange, chrome: {
    runtime: {
      id: "test", getURL: (path) => extensionUrl + path,
      getContexts: async () => [{ contextType: "SIDE_PANEL", documentId: "panel", tabId: 7, windowId: 1 }],
      onInstalled: event(), onMessage: { addListener(value) { listener = value; } },
      async sendMessage(message) {
        if (message.target === "offscreen") { exports.push(message); return { ok: true, noteCount: 0 }; }
        return { ok: true };
      },
    },
    tabs: {
      query: async () => [tab], get: async () => tab,
      onCreated: event(), onUpdated: event(), onActivated: event(), onRemoved: event(),
      async sendMessage(_id, message) {
        if (message.type === "GET_PAGE_CONTEXT") return { ok: true, context };
        if (message.type === "GET_FULL_YOUTUBE_TRANSCRIPT") {
          readCount += 1;
          markReadStarted();
          await pendingRead;
          return { ok: true, transcript };
        }
        throw new Error(`Unexpected message ${message.type}`);
      },
    },
    sidePanel: { setOptions: async () => {}, setPanelBehavior: async () => {} },
    offscreen: { hasDocument: async () => offscreenCount > 0, createDocument: async (options) => {
      assert.deepEqual(options.reasons, ["BLOBS"]); offscreenCount += 1;
    } },
    scripting: { executeScript: async () => { throw new Error("Unexpected injection"); } },
    windows: {}, storage: { local: { get: async () => ({}), set: async () => {} } },
  } });
  const repository = new VideoNotesRepository();
  try {
    await import(`../src/background.js?test=${crypto.randomUUID()}`);
    const request = (message) => new Promise((resolve) => listener(message, sender, resolve));
    const reading = request({ type: "GET_FULL_YOUTUBE_TRANSCRIPT", tabId: 7 });
    await readStarted;
    const exporting = request({ type: "EXPORT_SESSION", tabId: 7, sessionId: context.sessionId });
    // Let the export route reach its async repository/cache reads while the first read is pending.
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(readCount, 1);
    finishRead();
    assert.equal((await reading).ok, true);
    assert.equal((await exporting).ok, true);
    assert.equal(readCount, 1);
    assert.equal(exports[0].session.id, context.sessionId);
    assert.deepEqual(exports[0].transcript.cues, transcript.cues);
    assert.equal(await repository.getSession(context.sessionId), undefined, "无批注导出不创建空白笔记会话");
    assert.equal((await request({ type: "EXPORT_SESSION", tabId: 7, sessionId: context.sessionId })).ok, true);
    assert.equal(readCount, 1, "再次导出复用缓存");
    assert.equal(offscreenCount, 1);
    const count = exports.length;
    const rejected = await request({ type: "EXPORT_SESSION", tabId: 7, sessionId: "youtube:other" });
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /当前页面会话不匹配/);
    assert.equal(exports.length, count);
  } finally {
    finishRead();
    repository.close();
    Object.assign(globalThis, previous);
  }
});
