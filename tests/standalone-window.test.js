import assert from "node:assert/strict";
import test from "node:test";

import {
  createStandaloneWindowManager,
  standalonePanelUrl,
  standaloneTabIdFromUrl,
} from "../src/core/standalone-window.js";

const panelUrl = "chrome-extension://extension-id/sidepanel.html";

test("独立窗口地址只接受同一扩展侧栏页面中的有效标签页标识", () => {
  const url = standalonePanelUrl(panelUrl, 42);
  assert.equal(url, `${panelUrl}?mode=standalone&tabId=42`);
  assert.equal(standaloneTabIdFromUrl(url, panelUrl), 42);
  assert.equal(standaloneTabIdFromUrl(panelUrl, panelUrl), null);
  assert.equal(
    standaloneTabIdFromUrl(`${panelUrl}?mode=standalone&tabId=-1`, panelUrl),
    null,
  );
  assert.equal(
    standaloneTabIdFromUrl(
      "chrome-extension://other-extension/sidepanel.html?mode=standalone&tabId=42",
      panelUrl,
    ),
    null,
  );
});

function managerFixture() {
  const calls = [];
  let contexts = [];
  let nextWindowId = 70;
  let nextTabId = 700;
  let includeCreatedTabs = true;
  const manager = createStandaloneWindowManager({
    panelUrl,
    runtime: {
      async getContexts(filter) {
        calls.push(["contexts", filter]);
        return contexts;
      },
    },
    tabs: {
      async query(query) {
        calls.push(["tab-query", query]);
        return contexts
          .filter((context) => context.windowId === query.windowId)
          .map((context) => ({ id: context.tabId, windowId: context.windowId }));
      },
      async update(tabId, options) {
        calls.push(["tab-update", tabId, options]);
        const context = contexts.find((candidate) => candidate.tabId === tabId);
        if (context && options.url) context.documentUrl = options.url;
        return { id: tabId, windowId: context?.windowId };
      },
    },
    windows: {
      async create(options) {
        calls.push(["window-create", options]);
        const created = {
          id: nextWindowId,
          tabs: [{ id: nextTabId, windowId: nextWindowId }],
        };
        contexts = [{
          contextType: "TAB",
          documentUrl: options.url,
          tabId: nextTabId,
          windowId: nextWindowId,
        }];
        nextWindowId += 1;
        nextTabId += 1;
        return includeCreatedTabs ? created : { id: created.id };
      },
      async update(windowId, options) {
        calls.push(["window-update", windowId, options]);
        return { id: windowId };
      },
    },
  });
  return {
    calls,
    manager,
    setContexts(value) {
      contexts = value;
    },
    omitCreatedTabs() {
      includeCreatedTabs = false;
    },
  };
}

test("首次打开创建固定尺寸的可调整独立窗口", async () => {
  const fixture = managerFixture();
  const result = await fixture.manager.open({
    id: 5,
    windowId: 2,
    url: "https://www.youtube.com/watch?v=course",
  });

  assert.deepEqual(result, { reused: false, tabId: 700, windowId: 70 });
  assert.deepEqual(fixture.calls, [
    ["contexts", { contextTypes: ["TAB", "POPUP"] }],
    ["window-create", {
      focused: true,
      height: 800,
      type: "popup",
      url: `${panelUrl}?mode=standalone&tabId=5`,
      width: 480,
    }],
  ]);
});

test("创建结果未附带 tabs 时按新窗口标识找回独立页标签", async () => {
  const fixture = managerFixture();
  fixture.omitCreatedTabs();

  assert.deepEqual(await fixture.manager.open({
    id: 5,
    windowId: 2,
    url: "https://www.youtube.com/watch?v=course",
  }), { reused: false, tabId: 700, windowId: 70 });
  assert.deepEqual(fixture.calls.slice(-2), [
    ["window-create", {
      focused: true,
      height: 800,
      type: "popup",
      url: `${panelUrl}?mode=standalone&tabId=5`,
      width: 480,
    }],
    ["tab-query", { windowId: 70 }],
  ]);
});

test("重复点击复用唯一窗口并在目标变化时重新绑定", async () => {
  const fixture = managerFixture();
  await fixture.manager.open({
    id: 5,
    windowId: 2,
    url: "https://www.youtube.com/watch?v=course-a",
  });
  fixture.calls.length = 0;

  assert.deepEqual(await fixture.manager.open({
    id: 6,
    windowId: 2,
    url: "https://www.bilibili.com/video/BV1course",
  }), { reused: true, tabId: 700, windowId: 70 });
  assert.deepEqual(fixture.calls, [
    ["tab-update", 700, {
      active: true,
      url: `${panelUrl}?mode=standalone&tabId=6`,
    }],
    ["window-update", 70, { focused: true }],
  ]);
});

test("后台重启后从扩展上下文找回已有独立窗口", async () => {
  const fixture = managerFixture();
  fixture.setContexts([{
    contextType: "TAB",
    documentUrl: `${panelUrl}?mode=standalone&tabId=5`,
    tabId: 705,
    windowId: 75,
  }]);

  assert.deepEqual(await fixture.manager.open({
    id: 5,
    windowId: 2,
    url: "https://www.youtube.com/watch?v=course",
  }), { reused: true, tabId: 705, windowId: 75 });
  assert.deepEqual(fixture.calls, [
    ["contexts", { contextTypes: ["TAB", "POPUP"] }],
    ["tab-update", 705, { active: true }],
    ["window-update", 75, { focused: true }],
  ]);
});

test("并发点击通过单一队列复用刚创建的窗口", async () => {
  const fixture = managerFixture();
  const first = fixture.manager.open({
    id: 5,
    windowId: 2,
    url: "https://www.youtube.com/watch?v=course",
  });
  const second = fixture.manager.open({
    id: 5,
    windowId: 2,
    url: "https://www.youtube.com/watch?v=course",
  });

  const results = await Promise.all([first, second]);
  assert.deepEqual(results, [
    { reused: false, tabId: 700, windowId: 70 },
    { reused: true, tabId: 700, windowId: 70 },
  ]);
  assert.equal(
    fixture.calls.filter(([operation]) => operation === "window-create").length,
    1,
  );
});

test("只允许受支持的视频标签打开独立窗口", async () => {
  const fixture = managerFixture();
  await assert.rejects(
    fixture.manager.open({ id: 5, windowId: 2, url: "https://example.com/" }),
    /请先打开支持的视频页面/,
  );
  assert.deepEqual(fixture.calls, []);
});
