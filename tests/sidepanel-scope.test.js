import assert from "node:assert/strict";
import test from "node:test";

import * as sidePanelScope from "../src/core/sidepanel-scope.js";
import {
  activeContextChangedMessage,
  createActiveTabActivationHandler,
  createCurrentPageContextReader,
  createExistingSidePanelOptionsConfigurator,
  createSidePanelContextResolver,
  createSidePanelRefreshController,
  contextChangedSenderTab,
  isSidePanelRefreshMessage,
  sidePanelMessageForTabUpdate,
  sidePanelContextForSender,
  sidePanelRequestTabIdForSender,
  sidePanelTabIdForSender,
  sidePanelOptionsForTab,
} from "../src/core/sidepanel-scope.js";

test("后台标签激活处理器把浏览器窗口标识写入实际广播", async () => {
  const calls = [];
  const handler = createActiveTabActivationHandler({
    tabs: {
      async get(tabId) {
        calls.push(["get", tabId]);
        return { id: tabId, url: "https://www.youtube.com/watch?v=course" };
      },
    },
    async configureSidePanelForTab(tab) {
      calls.push(["configure", tab.id]);
    },
    runtime: {
      async sendMessage(message) {
        calls.push(["send", message]);
      },
    },
  });

  await handler({ tabId: 3, windowId: 20 });
  assert.deepEqual(calls, [
    ["get", 3],
    ["configure", 3],
    ["send", { type: "ACTIVE_CONTEXT_CHANGED", tabId: 3, windowId: 20 }],
  ]);
});

test("普通网页返回空上下文且不发送页面请求", async () => {
  const pageRequests = [];
  let tab = { id: 9, url: "https://example.com/" };
  const readCurrentPageContext = createCurrentPageContextReader({
    async targetTab() {
      return tab;
    },
    async sendPageContextRequest(tabId) {
      pageRequests.push(tabId);
      return { context: { sessionId: "youtube:a" } };
    },
  });

  assert.equal(await readCurrentPageContext({ tabId: 9 }), null);
  assert.deepEqual(pageRequests, []);

  tab = { id: 7, url: "https://www.youtube.com/watch?v=a" };
  assert.deepEqual(await readCurrentPageContext({ tabId: 7 }), {
    sessionId: "youtube:a",
  });
  assert.deepEqual(pageRequests, [7]);
});

test("后台侧栏解析器按 sender 窗口查询并只在 Edge 全缺失时回退", async () => {
  let contexts = [];
  const calls = [];
  const resolveContext = createSidePanelContextResolver({
    runtime: {
      async getContexts(filter) {
        calls.push(["contexts", filter]);
        return contexts;
      },
    },
    tabs: {
      async get(tabId) {
        calls.push(["get", tabId]);
        return { id: tabId, windowId: 30 };
      },
      async query(query) {
        calls.push(["query", query]);
        return query.windowId === 10
          ? [{ id: 17, windowId: 10 }]
          : [{ id: 27, windowId: 20 }];
      },
    },
  });

  contexts = [
    { contextType: "SIDE_PANEL", documentId: "panel-a", tabId: 1, windowId: 10 },
    { contextType: "SIDE_PANEL", documentId: "panel-b", tabId: 2, windowId: 20 },
  ];
  assert.deepEqual((await resolveContext({ documentId: "panel-b" })).context, {
    tabId: 2,
    windowId: 20,
  });
  assert.deepEqual(calls.splice(0), [
    ["contexts", { contextTypes: ["SIDE_PANEL"] }],
  ]);

  contexts = [{
    contextType: "SIDE_PANEL",
    documentId: "panel-a",
    tabId: -1,
    windowId: 10,
  }];
  assert.deepEqual((await resolveContext({ documentId: "panel-a" })).context, {
    tabId: 17,
    windowId: 10,
  });
  assert.deepEqual(calls.splice(0), [
    ["contexts", { contextTypes: ["SIDE_PANEL"] }],
    ["query", { active: true, windowId: 10 }],
  ]);

  contexts = [{
    contextType: "SIDE_PANEL",
    documentId: "edge-panel",
    tabId: -1,
    windowId: -1,
  }];
  assert.deepEqual((await resolveContext({ documentId: "edge-panel" })).context, {
    tabId: 27,
    windowId: 20,
  });
  assert.deepEqual(calls.splice(0), [
    ["contexts", { contextTypes: ["SIDE_PANEL"] }],
    ["query", { active: true, lastFocusedWindow: true }],
  ]);
});

test("活动标签广播同时携带标签页和窗口标识", () => {
  assert.deepEqual(
    activeContextChangedMessage(7, 3),
    { type: "ACTIVE_CONTEXT_CHANGED", tabId: 7, windowId: 3 },
  );
  assert.equal(activeContextChangedMessage(7, -1), null);
});

test("侧栏历史请求拒绝已经切换前的旧标签页标识", () => {
  const sender = { documentId: "panel-a" };
  const contexts = [{
    contextType: "SIDE_PANEL",
    documentId: "panel-a",
    tabId: 2,
  }];

  assert.throws(
    () => sidePanelRequestTabIdForSender(sender, contexts, 2, 1),
    /侧栏所属标签页已变化/,
  );
  assert.equal(sidePanelRequestTabIdForSender(sender, contexts, 2, 2), 2);
});

test("标签页加载完成后通知已打开侧栏重试当前页面", () => {
  assert.deepEqual(
    sidePanelMessageForTabUpdate(7, { status: "complete" }, {
      active: true,
      url: "https://www.youtube.com/watch?v=course-a",
    }),
    { type: "TAB_LOAD_COMPLETE", tabId: 7 },
  );
  assert.equal(sidePanelMessageForTabUpdate(7, { status: "complete" }, {
    active: false,
    url: "https://www.youtube.com/watch?v=course-a",
  }), null);
  assert.equal(sidePanelMessageForTabUpdate(7, { status: "loading" }, {
    active: true,
    url: "https://www.youtube.com/watch?v=course-a",
  }), null);
  assert.equal(sidePanelMessageForTabUpdate(
    7,
    { url: "https://www.youtube.com/watch?v=next" },
    { active: true, url: "https://www.youtube.com/watch?v=course-a" },
  ), null);
  assert.equal(sidePanelMessageForTabUpdate(7, { status: "complete" }, {
    active: true,
    url: "https://example.com/",
  }), null);
  assert.equal(sidePanelMessageForTabUpdate(7, { status: "complete" }, {
    active: true,
    url: "https://www.youtube.com/",
  }), null);
  assert.equal(sidePanelMessageForTabUpdate(7, { status: "complete" }, {
    active: true,
    url: "https://www.bilibili.com/",
  }), null);
});

test("侧栏接收页面加载完成消息", () => {
  assert.equal(isSidePanelRefreshMessage({ type: "TAB_LOAD_COMPLETE" }), true);
  assert.equal(isSidePanelRefreshMessage({ type: "UNRELATED" }), false);
});

test("标签页侧栏只在受支持的视频页面启用", () => {
  assert.deepEqual(sidePanelOptionsForTab({
    id: 7,
    url: "https://www.youtube.com/watch?v=course",
  }), {
    tabId: 7,
    path: "sidepanel.html",
    enabled: true,
  });
  assert.deepEqual(sidePanelOptionsForTab({
    id: 8,
    url: "https://www.bilibili.com/video/BV1xx411c7mD",
  }), {
    tabId: 8,
    path: "sidepanel.html",
    enabled: true,
  });
  assert.deepEqual(sidePanelOptionsForTab({ id: 9, url: "https://example.com/" }), {
    tabId: 9,
    enabled: false,
  });
});

test("后台每次加载时按网址重新配置所有现有标签页", async () => {
  assert.equal(typeof sidePanelScope.createExistingSidePanelOptionsConfigurator, "function");
  const writes = [];
  const configureExistingSidePanelOptions = createExistingSidePanelOptionsConfigurator({
    tabs: {
      async query(query) {
        assert.deepEqual(query, {});
        return [
          { id: 1, url: "https://www.youtube.com/watch?v=course" },
          { id: 2, url: "https://example.com/" },
          { id: "invalid", url: "https://www.youtube.com/watch?v=ignored" },
        ];
      },
    },
    sidePanel: {
      async setOptions(options) {
        writes.push(options);
      },
    },
  });

  await configureExistingSidePanelOptions();

  assert.deepEqual(writes, [
    { tabId: 1, path: "sidepanel.html", enabled: true },
    { tabId: 2, enabled: false },
  ]);
});

test("没有数字 tabId 时拒绝配置", () => {
  assert.throws(() => sidePanelOptionsForTab({ url: "https://example.com/" }), /tabId/);
});

test("视频内容脚本发送者提供有效标签页", () => {
  const tab = {
    id: 11,
    url: "https://www.youtube.com/watch?v=course-a",
  };

  assert.equal(contextChangedSenderTab({ tab, url: tab.url }), tab);
});

test("扩展页发送者没有有效标签页时不触发上下文刷新", () => {
  assert.equal(
    contextChangedSenderTab({ url: "chrome-extension://extension-id/sidepanel.html" }),
    null,
  );
  assert.equal(contextChangedSenderTab({ tab: { id: "11" } }), null);
});

test("侧栏上下文按所属标签页隔离，并在重新可见时刷新自身会话", () => {
  let refreshesA = 0;
  let refreshesB = 0;
  const panelA = createSidePanelRefreshController(() => { refreshesA += 1; });
  const panelB = createSidePanelRefreshController(() => { refreshesB += 1; });
  const draftA = { text: "A 的草稿" };

  assert.equal(panelA.handleContextChanged({ tabId: 1 }), false);
  panelA.setTabId(1);
  panelB.setTabId(2);

  assert.equal(panelA.handleContextChanged({ tabId: 2 }), false);
  assert.equal(refreshesA, 0);
  assert.equal(draftA.text, "A 的草稿");
  assert.equal(panelA.handleContextChanged({ tabId: 1 }), true);
  assert.equal(refreshesA, 1);
  assert.equal(refreshesB, 0);

  assert.equal(panelB.handleContextChanged({ tabId: 2 }), true);
  assert.equal(refreshesA, 1);
  assert.equal(refreshesB, 1);
  assert.equal(panelA.handleVisibilityChange(false), false);
  assert.equal(panelA.handleVisibilityChange(true), true);
  assert.equal(refreshesA, 2);
});

test("活动课程标签切换时侧栏接管新标签并刷新", () => {
  let refreshedMessage = null;
  const tabChanges = [];
  const panel = createSidePanelRefreshController((message) => {
    refreshedMessage = message;
  }, {
    onTabChanged(previousTabId, tabId) {
      tabChanges.push([previousTabId, tabId]);
    },
  });
  panel.setTabId(1, 10);

  assert.equal(panel.handleContextChanged({
    type: "ACTIVE_CONTEXT_CHANGED",
    tabId: 2,
    windowId: 10,
  }), true);
  assert.equal(panel.tabId, 2);
  assert.deepEqual(refreshedMessage, {
    type: "ACTIVE_CONTEXT_CHANGED",
    tabId: 2,
    windowId: 10,
  });
  assert.deepEqual(tabChanges, [[1, 2]]);
});

test("两个窗口只让匹配窗口的侧栏接管活动标签", () => {
  let refreshesA = 0;
  let refreshesB = 0;
  const panelA = createSidePanelRefreshController(() => { refreshesA += 1; });
  const panelB = createSidePanelRefreshController(() => { refreshesB += 1; });
  panelA.setTabId(1, 10);
  panelB.setTabId(2, 20);

  const message = { type: "ACTIVE_CONTEXT_CHANGED", tabId: 3, windowId: 20 };
  assert.equal(panelA.handleContextChanged(message), false);
  assert.equal(panelB.handleContextChanged(message), true);
  assert.equal(panelA.tabId, 1);
  assert.equal(panelB.tabId, 3);
  assert.equal(refreshesA, 0);
  assert.equal(refreshesB, 1);
});

test("页面加载完成只刷新所属侧栏且不改写其他侧栏绑定", () => {
  let refreshesA = 0;
  let refreshesB = 0;
  const panelA = createSidePanelRefreshController(() => { refreshesA += 1; });
  const panelB = createSidePanelRefreshController(() => { refreshesB += 1; });
  panelA.setTabId(1);
  panelB.setTabId(2);

  const message = { type: "TAB_LOAD_COMPLETE", tabId: 2 };
  assert.equal(panelA.handleContextChanged(message), false);
  assert.equal(panelB.handleContextChanged(message), true);
  assert.equal(panelA.tabId, 1);
  assert.equal(panelB.tabId, 2);
  assert.equal(refreshesA, 0);
  assert.equal(refreshesB, 1);
});

test("编辑中重新可见延后刷新，并在编辑完成后只刷新一次", () => {
  let editing = true;
  let refreshes = 0;
  const panel = createSidePanelRefreshController(
    () => { refreshes += 1; },
    { shouldDeferRefresh: () => editing },
  );
  panel.setTabId(1);

  assert.equal(panel.handleVisibilityChange(true), true);
  assert.equal(refreshes, 0);

  editing = false;
  assert.equal(panel.flushDeferredRefresh(), true);
  assert.equal(refreshes, 1);
  assert.equal(panel.flushDeferredRefresh(), false);

  assert.equal(panel.handleVisibilityChange(true), true);
  assert.equal(refreshes, 2);
});

test("编辑失焦后设置变化等保存完成再刷新一次", () => {
  let editing = true;
  let saving = false;
  let refreshes = 0;
  const panel = createSidePanelRefreshController(
    () => { refreshes += 1; },
    { shouldDeferRefresh: () => editing || saving },
  );

  editing = false;
  saving = true;
  assert.equal(panel.requestRefresh({ type: "SUBTITLE_SETTINGS_CHANGED" }), false);
  assert.equal(refreshes, 0);

  saving = false;
  assert.equal(panel.flushDeferredRefresh(), true);
  assert.equal(refreshes, 1);
  assert.equal(panel.flushDeferredRefresh(), false);
});

test("保存失败后继续延迟刷新直到用户解决未保存编辑", () => {
  let saving = true;
  let unresolvedEdit = false;
  let refreshes = 0;
  const panel = createSidePanelRefreshController(
    () => { refreshes += 1; },
    { shouldDeferRefresh: () => saving || unresolvedEdit },
  );

  assert.equal(panel.requestRefresh({ type: "SUBTITLE_SETTINGS_CHANGED" }), false);
  saving = false;
  unresolvedEdit = true;
  assert.equal(panel.requestRefresh({ type: "NOTE_TRANSCRIBED" }), false);
  assert.equal(refreshes, 0);

  unresolvedEdit = false;
  assert.equal(panel.flushDeferredRefresh(), true);
  assert.equal(refreshes, 1);
  assert.equal(panel.flushDeferredRefresh(), false);
});

test("编辑中录音结束只延后列表刷新，录音 UI 仍立即更新", () => {
  let editing = true;
  let refreshes = 0;
  let voiceUiEffects = 0;
  const panel = createSidePanelRefreshController(
    () => { refreshes += 1; },
    {
      onContextEvent(message) {
        if (message.type === "VOICE_STATE_CHANGED") voiceUiEffects += 1;
      },
      shouldRefresh: (message) => (
        message.type !== "VOICE_STATE_CHANGED" || message.recording === false
      ),
      shouldDeferRefresh: () => editing,
    },
  );
  panel.setTabId(1);

  panel.handleContextChanged({ type: "VOICE_STATE_CHANGED", tabId: 1, recording: true });
  panel.handleContextChanged({ type: "VOICE_STATE_CHANGED", tabId: 1, recording: false });
  panel.handleVisibilityChange(true);
  panel.handleContextChanged({ type: "NOTE_TRANSCRIBED", tabId: 1 });
  assert.equal(voiceUiEffects, 2);
  assert.equal(refreshes, 0);

  editing = false;
  assert.equal(panel.flushDeferredRefresh(), true);
  assert.equal(refreshes, 1);
  assert.equal(panel.flushDeferredRefresh(), false);

  panel.handleContextChanged({ type: "VOICE_STATE_CHANGED", tabId: 1, recording: false });
  assert.equal(voiceUiEffects, 3);
  assert.equal(refreshes, 2);
});

test("侧栏通过自身文档标识解析所属标签页", () => {
  assert.equal(
    sidePanelTabIdForSender(
      { documentId: "panel-a" },
      [
        { contextType: "SIDE_PANEL", documentId: "panel-b", tabId: 2 },
        { contextType: "SIDE_PANEL", documentId: "panel-a", tabId: 1 },
      ],
    ),
    1,
  );
  assert.equal(sidePanelTabIdForSender({ documentId: "late-panel" }, []), null);
});

test("Edge 侧栏不提供有效标签页时回退到当前课程标签页", () => {
  assert.equal(
    sidePanelTabIdForSender(
      {},
      [{
        contextType: "SIDE_PANEL",
        documentId: "edge-panel",
        tabId: -1,
        windowId: -1,
      }],
      17,
    ),
    17,
  );
});

test("侧栏文档解析自身窗口并在 context 缺少 tabId 时使用本窗口活动标签", () => {
  assert.deepEqual(
    sidePanelContextForSender(
      { documentId: "panel-a" },
      [{
        contextType: "SIDE_PANEL",
        documentId: "panel-a",
        tabId: -1,
        windowId: 10,
      }],
      { id: 17, windowId: 10 },
    ),
    { tabId: 17, windowId: 10 },
  );
});
