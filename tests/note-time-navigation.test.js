import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

import { buildMarkdown, formatTimestamp } from "../src/core/note-format.js";
import { parseVideoContext } from "../src/core/site-adapter.js";
import { seekMediaForVideoContext } from "../src/core/video-command-context.js";

const source = await readFile(new URL("../src/sidepanel.js", import.meta.url), "utf8");
// 执行时间链接的实际创建和事件绑定，只替换浏览器 DOM 与扩展消息边界。
const linkStart = source.indexOf('    const time = document.createElement("a");');
const linkEnd = source.indexOf('    const kind = document.createElement("span");', linkStart);
assert.ok(linkStart >= 0 && linkEnd > linkStart);
const requestStart = source.indexOf("const PAGE_SCOPED_REQUESTS =");
const requestEnd = source.indexOf("\nfunction currentLocalTranscriptNoteSource", requestStart);
assert.ok(requestStart >= 0 && requestEnd > requestStart);

const videoUrls = [
  "https://www.youtube.com/watch?v=course&t=2325s",
  "https://www.bilibili.com/video/BV1example?p=2&t=2325",
];

function fixture({ jumpUrl = videoUrls[0], activeUrl = jumpUrl, pageUrl = activeUrl,
  activeTabId = 22, media = { currentTime: 12, duration: 4200, paused: true },
  seekError, openError } = {}) {
  const note = { sessionId: parseVideoContext(jumpUrl).sessionId, seconds: 2325, jumpUrl, tabId: 11 };
  const requests = [];
  const opened = [];
  const errors = [];
  const listeners = new Map();
  const link = runInNewContext(`
    ${source.slice(requestStart, requestEnd)}
    ${source.slice(linkStart, linkEnd)}
    time;
  `, {
    note, formatTimestamp,
    activeContext: parseVideoContext(activeUrl),
    activeContextTabId: activeTabId,
    sidePanelRefresh: { tabId: 22 },
    document: { createElement: () => ({
      addEventListener: (type, listener) => listeners.set(type, listener),
    }) },
    chrome: {
      runtime: { sendMessage: async (message) => {
        requests.push({ ...message });
        assert.equal(message.type, "SEEK_VIDEO");
        if (seekError) throw seekError;
        return { ok: true, seconds: seekMediaForVideoContext({
          media,
          context: parseVideoContext(pageUrl),
          expectedSessionId: message.sessionId,
          expectedVideoId: message.videoId,
          seconds: message.seconds,
        }) };
      } },
      tabs: { create: async ({ url }) => {
        if (openError) throw openError;
        opened.push(url);
        return { id: 33 };
      } },
    },
    showToast: (message) => errors.push(message),
  });
  return {
    note, link, media, requests, opened, errors,
    async click(overrides = {}) {
      const event = { button: 0, defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; }, ...overrides };
      const pending = listeners.get("click")?.(event);
      const preventedSynchronously = event.defaultPrevented;
      await pending;
      return preventedSynchronously;
    },
  };
}

test("普通点击同一视频的旧笔记直接定位当前播放器，保留播放状态且不新开标签", async () => {
  for (const jumpUrl of videoUrls) {
    for (const paused of [true, false]) {
      const view = fixture({ jumpUrl, media: { currentTime: 12, duration: 4200, paused } });
      assert.equal(await view.click(), true);
      assert.equal(view.media.currentTime, 2325);
      assert.equal(view.media.paused, paused);
      assert.deepEqual(view.opened, []);
      assert.deepEqual(view.requests, [{ type: "SEEK_VIDEO", tabId: 22, seconds: 2325,
        sessionId: view.note.sessionId, videoId: parseVideoContext(jumpUrl).videoId }]);
    }
  }
});

test("离开视频、切到其他视频或 B 站分 P、侧栏正在切换标签时保留原始新标签链接", async () => {
  for (const options of [
    { activeUrl: "https://example.com/notes" },
    { activeUrl: "https://www.youtube.com/watch?v=other" },
    { jumpUrl: videoUrls[1], activeUrl: "https://www.bilibili.com/video/BV1example?p=1" },
    { activeTabId: 11 },
  ]) {
    const view = fixture(options);
    assert.equal(await view.click(), false);
    assert.equal(view.link.href, view.note.jumpUrl);
    assert.equal(view.link.target, "_blank");
    assert.equal(view.media.currentTime, 12);
    assert.deepEqual(view.requests, []);
  }
});

test("点击时页面已切换但侧栏尚未刷新，不改变新视频进度并回退打开原视频", async () => {
  for (const options of [
    { pageUrl: "https://www.youtube.com/watch?v=other" },
    { pageUrl: "https://example.com/notes" },
    { jumpUrl: videoUrls[1], pageUrl: "https://www.bilibili.com/video/BV1example?p=1" },
  ]) {
    const view = fixture(options);
    assert.equal(await view.click(), true);
    assert.equal(view.media.currentTime, 12);
    assert.deepEqual(view.opened, [view.note.jumpUrl]);
    assert.deepEqual(view.errors, []);
  }
});

test("原标签关闭、消息失败或播放器不可用时回退打开带时间的链接", async () => {
  for (const options of [
    { seekError: new Error("原视频标签页已关闭") },
    { seekError: new Error("Receiving end does not exist") },
    { media: null },
  ]) {
    const view = fixture(options);
    assert.equal(await view.click(), true);
    assert.deepEqual(view.opened, [videoUrls[0]]);
    assert.deepEqual(view.errors, []);
  }
});

test("修饰键、中键和已处理的点击保留浏览器链接行为", async () => {
  for (const event of [
    { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true },
    { button: 1 }, { defaultPrevented: true },
  ]) {
    const view = fixture();
    assert.equal(await view.click(event), event.defaultPrevented ?? false);
    assert.deepEqual(view.requests, []);
    assert.deepEqual(view.opened, []);
    assert.equal(view.media.currentTime, 12);
  }
});

test("回退开页也失败时显示错误，点击处理不会产生未捕获异常", async () => {
  const view = fixture({ media: null, openError: new Error("无法打开视频") });
  assert.equal(await view.click(), true);
  assert.deepEqual(view.errors, ["无法打开视频"]);
});

test("导出的 Markdown 保留可在扩展外打开的 YouTube 和 B 站分 P 时间链接", () => {
  for (const jumpUrl of videoUrls) {
    const markdown = buildMarkdown(parseVideoContext(jumpUrl), [{ seconds: 2325, jumpUrl }]);
    assert.ok(markdown.includes(`## 001 · [00:38:45](${jumpUrl})`));
  }
});
