import assert from "node:assert/strict";
import test from "node:test";

import { applySubtitleEdit } from "../src/core/note-editing.js";

test("字幕编辑只更新字幕内容和更新时间", () => {
  const original = {
    id: "note-1",
    body: "个人正文",
    subtitleContext: "原字幕",
    userEditVersion: 3,
    updatedAt: 100,
  };

  assert.deepEqual(applySubtitleEdit(original, "  修订字幕  ", 200), {
    id: "note-1",
    body: "个人正文",
    subtitleContext: "修订字幕",
    userEditVersion: 3,
    updatedAt: 200,
  });
  assert.equal(original.subtitleContext, "原字幕");
});

test("字幕编辑允许清空内容", () => {
  const updated = applySubtitleEdit({
    id: "note-1",
    subtitleContext: "原字幕",
    userEditVersion: 1,
  }, "   ", 300);

  assert.equal(updated.subtitleContext, "");
  assert.equal(updated.userEditVersion, 1);
});
