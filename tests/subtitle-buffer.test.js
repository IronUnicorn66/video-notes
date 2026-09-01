import assert from "node:assert/strict";
import test from "node:test";

import { SubtitleBuffer } from "../src/core/subtitle-buffer.js";
import { SubtitleCapture } from "../src/core/subtitle-capture.js";
import { readRenderedSubtitleText } from "../src/core/subtitle-text.js";

test("字幕缓冲去重并提取标记前窗口", () => {
  const buffer = new SubtitleBuffer({ retentionSeconds: 60 });
  buffer.add(70, "第一");
  buffer.add(71, "第一句。");
  buffer.add(82, "第二句");
  buffer.add(95, "标记之后");

  assert.equal(buffer.before(90, { seconds: 20, maxChars: 500 }), "第一句。\n第二句");
});

test("字幕按最大字符数从靠近标记处向前截断", () => {
  const buffer = new SubtitleBuffer();
  buffer.add(10, "12345");
  buffer.add(20, "67890");
  buffer.add(30, "abcde");

  assert.equal(buffer.before(31, { seconds: 30, maxChars: 11 }), "67890 abcde");
});

test("字幕窗口首尾残句会保留并与完整句连续合并", () => {
  const buffer = new SubtitleBuffer();
  buffer.add(10, "middle fragment");
  buffer.add(12, "continues. trailing");

  assert.equal(
    buffer.before(15, { seconds: 10, maxChars: 500 }),
    "middle fragment continues.\ntrailing",
  );
});

test("清理超过保留窗口的字幕", () => {
  const buffer = new SubtitleBuffer({ retentionSeconds: 60 });
  buffer.add(1, "过期");
  buffer.add(62, "保留");

  assert.equal(buffer.before(62, { seconds: 60, maxChars: 500 }), "保留");
});

test("沉浸式双语字幕进入采集缓冲后保留换行", () => {
  const cue = (text) => ({
    textContent: text,
    getClientRects: () => [{}],
  });
  const container = {
    getClientRects: () => [{}],
    querySelectorAll: () => [
      cue("  source   text\n\n  continued  "),
      cue("  target\ttext  "),
    ],
  };
  const root = {
    querySelectorAll: (selector) => selector === ".imt-captions-text" ? [container] : [],
  };
  const capture = new SubtitleCapture({ subtitleEnabled: true });

  capture.add(10, readRenderedSubtitleText(root, "youtube"));

  assert.equal(
    capture.before(10),
    "source text\ncontinued\ntarget text",
  );
});
