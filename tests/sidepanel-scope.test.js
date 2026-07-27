import assert from "node:assert/strict";
import test from "node:test";

import {
  createSidePanelRefreshController,
  contextChangedSenderTab,
  isSidePanelRefreshMessage,
  sidePanelMessageForTabUpdate,
  sidePanelRequestTabIdForSender,
  sidePanelTabIdForSender,
  sidePanelOptionsForTab,
} from "../src/core/sidepanel-scope.js";

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

test("YouTube 和哔哩哔哩视频标签启用侧栏", () => {
  assert.deepEqual(sidePanelOptionsForTab({ id: 7, url: "https://www.youtube.com/watch?v=abc123" }), {
    tabId: 7,
    path: "sidepanel.html",
    enabled: true,
  });
  assert.deepEqual(sidePanelOptionsForTab({ id: 8, url: "https://www.bilibili.com/video/BV1xx411c7mD?p=2" }), {
    tabId: 8,
    path: "sidepanel.html",
    enabled: true,
  });
});

test("普通网页和无 URL 标签禁用侧栏", () => {
  assert.deepEqual(sidePanelOptionsForTab({ id: 9, url: "https://example.com/" }), {
    tabId: 9,
    enabled: false,
  });
  assert.deepEqual(sidePanelOptionsForTab({ id: 10 }), { tabId: 10, enabled: false });
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
  const panel = createSidePanelRefreshController((message) => {
    refreshedMessage = message;
  });
  panel.setTabId(1);

  assert.equal(panel.handleContextChanged({ type: "ACTIVE_CONTEXT_CHANGED", tabId: 2 }), true);
  assert.equal(panel.tabId, 2);
  assert.deepEqual(refreshedMessage, { type: "ACTIVE_CONTEXT_CHANGED", tabId: 2 });
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
