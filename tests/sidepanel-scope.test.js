import assert from "node:assert/strict";
import test from "node:test";

import { sidePanelOptionsForTab } from "../src/core/sidepanel-scope.js";

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
