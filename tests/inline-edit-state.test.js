import assert from "node:assert/strict";
import test from "node:test";

import {
  inlineEditResolution,
  inlineEditStartingText,
  shouldDeferInlineEditRefresh,
} from "../src/core/inline-edit-state.js";

test("保存失败保留当前文本并继续阻止延迟刷新", () => {
  assert.deepEqual(inlineEditResolution({
    canceled: false,
    saveSucceeded: false,
    text: "尚未保存的字幕",
  }), {
    retryText: "尚未保存的字幕",
    allowDeferredRefresh: false,
  });
});

test("保存成功或取消后清理重试文本并允许延迟刷新", () => {
  assert.deepEqual(inlineEditResolution({
    canceled: false,
    saveSucceeded: true,
    text: "已保存字幕",
  }), {
    retryText: null,
    allowDeferredRefresh: true,
  });
  assert.deepEqual(inlineEditResolution({
    canceled: true,
    saveSucceeded: false,
    text: "放弃的字幕",
  }), {
    retryText: null,
    allowDeferredRefresh: true,
  });
});

test("再次编辑优先使用未保存文本并保留空字符串", () => {
  assert.equal(inlineEditStartingText("未保存字幕", "历史字幕"), "未保存字幕");
  assert.equal(inlineEditStartingText("", "历史字幕"), "");
  assert.equal(inlineEditStartingText(undefined, "历史字幕"), "历史字幕");
});

test("编辑、保存或失败重试任一未解决时阻止直接刷新", () => {
  assert.equal(shouldDeferInlineEditRefresh({ editing: true }), true);
  assert.equal(shouldDeferInlineEditRefresh({ pendingSaveCount: 1 }), true);
  assert.equal(shouldDeferInlineEditRefresh({ retryCount: 1 }), true);
  assert.equal(shouldDeferInlineEditRefresh({}), false);
});
