import assert from "node:assert/strict";
import test from "node:test";

import {
  createFullTranscriptDisplayBinding,
  fullTranscriptDisplayPreferenceAfterChange,
  normalizeFullTranscriptDisplayPreference,
  transcriptGroupsFullyTranslated,
} from "../src/core/full-transcript-display.js";

function control(checked = true) {
  const listeners = new Map();
  return {
    checked,
    disabled: false,
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    dispatch(type) {
      listeners.get(type)?.();
    },
  };
}

test("完整字幕显示偏好默认双语并修复全部关闭的异常值", () => {
  assert.deepEqual(normalizeFullTranscriptDisplayPreference(), {
    showOriginal: true,
    showTranslation: true,
  });
  assert.deepEqual(normalizeFullTranscriptDisplayPreference({
    showOriginal: true,
    showTranslation: false,
  }), {
    showOriginal: true,
    showTranslation: false,
  });
  assert.deepEqual(normalizeFullTranscriptDisplayPreference({
    showOriginal: false,
    showTranslation: true,
  }), {
    showOriginal: false,
    showTranslation: true,
  });
  assert.deepEqual(normalizeFullTranscriptDisplayPreference({
    showOriginal: false,
    showTranslation: false,
  }), {
    showOriginal: true,
    showTranslation: true,
  });
});

test("完整字幕显示模式始终至少保留原文或译文之一", () => {
  assert.deepEqual(fullTranscriptDisplayPreferenceAfterChange({
    showOriginal: true,
    showTranslation: true,
  }, "showTranslation", false), {
    showOriginal: true,
    showTranslation: false,
  });
  assert.deepEqual(fullTranscriptDisplayPreferenceAfterChange({
    showOriginal: true,
    showTranslation: false,
  }, "showOriginal", false), {
    showOriginal: true,
    showTranslation: false,
  });
});

test("只有当前档位全部段落都存在译文时显示查看选项", () => {
  assert.equal(transcriptGroupsFullyTranslated([]), false);
  assert.equal(transcriptGroupsFullyTranslated([
    { id: "0:5", translation: "第一段" },
    { id: "5:10", translation: "第二段" },
  ]), true);
  assert.equal(transcriptGroupsFullyTranslated([
    { id: "0:5", translation: "第一段" },
    { id: "5:10", translation: " " },
  ]), false);
});

test("完整字幕显示绑定保存选择并同步最后一个选项的禁用状态", async () => {
  const original = control();
  const translation = control();
  const group = { hidden: true };
  const saved = [];
  let renderCount = 0;
  const binding = createFullTranscriptDisplayBinding({
    group,
    original,
    translation,
    storage: { set: async (value) => saved.push(value) },
    render: () => { renderCount += 1; },
  });

  binding.setAvailable(true);
  await binding.change("showTranslation", false);

  assert.equal(group.hidden, false);
  assert.deepEqual(binding.preference(), {
    showOriginal: true,
    showTranslation: false,
  });
  assert.equal(original.checked, true);
  assert.equal(original.disabled, true);
  assert.equal(translation.checked, false);
  assert.equal(translation.disabled, false);
  assert.equal(renderCount, 1);
  assert.deepEqual(saved, [{
    fullTranscriptShowOriginal: true,
    fullTranscriptShowTranslation: false,
  }]);
});

test("完整字幕显示偏好保存失败时恢复先前状态并报告错误", async () => {
  const original = control();
  const translation = control();
  const error = new Error("storage failed");
  const errors = [];
  let renderCount = 0;
  const binding = createFullTranscriptDisplayBinding({
    group: { hidden: false },
    original,
    translation,
    storage: { set: async () => { throw error; } },
    render: () => { renderCount += 1; },
    onError: (value) => errors.push(value),
  });

  binding.setAvailable(true);
  await binding.change("showOriginal", false);

  assert.deepEqual(binding.preference(), {
    showOriginal: true,
    showTranslation: true,
  });
  assert.equal(original.checked, true);
  assert.equal(translation.checked, true);
  assert.equal(renderCount, 2);
  assert.deepEqual(errors, [error]);
});

test("翻译未完成时隐藏选项并回退到双语显示，完成后恢复偏好", () => {
  const binding = createFullTranscriptDisplayBinding({
    group: { hidden: true },
    original: control(),
    translation: control(),
    storage: { set: async () => {} },
    render: () => {},
  });
  binding.sync({ showOriginal: false, showTranslation: true });

  binding.setAvailable(false);
  assert.deepEqual(binding.effectivePreference(), {
    showOriginal: true,
    showTranslation: true,
  });

  binding.setAvailable(true);
  assert.deepEqual(binding.effectivePreference(), {
    showOriginal: false,
    showTranslation: true,
  });
});
