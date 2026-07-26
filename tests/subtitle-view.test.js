import assert from "node:assert/strict";
import test from "node:test";

import { subtitleBlockState } from "../src/core/subtitle-view.js";

test("关闭设置时隐藏字幕块并保留笔记数据", () => {
  const note = { subtitleContext: "历史字幕" };
  assert.deepEqual(subtitleBlockState(note, false), {
    visible: false,
    empty: false,
    text: "历史字幕",
  });
  assert.equal(note.subtitleContext, "历史字幕");
});

test("开启设置时区分已有字幕和空字幕", () => {
  assert.deepEqual(subtitleBlockState({ subtitleContext: "  老师原话  " }, true), {
    visible: true,
    empty: false,
    text: "老师原话",
  });
  assert.deepEqual(subtitleBlockState({}, true), {
    visible: true,
    empty: true,
    text: "",
  });
});
