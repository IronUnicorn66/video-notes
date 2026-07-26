import assert from "node:assert/strict";
import test from "node:test";

import {
  createSidePanelRefreshController,
  contextChangedSenderTab,
  sidePanelTabIdForSender,
  sidePanelOptionsForTab,
} from "../src/core/sidepanel-scope.js";

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
