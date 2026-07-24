import assert from "node:assert/strict";
import test from "node:test";

import { SubtitleBuffer } from "../src/core/subtitle-buffer.js";

test("字幕缓冲去重并提取标记前窗口", () => {
  const buffer = new SubtitleBuffer({ retentionSeconds: 60 });
  buffer.add(70, "第一句");
  buffer.add(71, "第一句");
  buffer.add(82, "第二句");
  buffer.add(95, "标记之后");

  assert.equal(buffer.before(90, { seconds: 20, maxChars: 500 }), "第一句\n第二句");
});

test("字幕按最大字符数从靠近标记处向前截断", () => {
  const buffer = new SubtitleBuffer();
  buffer.add(10, "12345");
  buffer.add(20, "67890");
  buffer.add(30, "abcde");

  assert.equal(buffer.before(31, { seconds: 30, maxChars: 11 }), "67890\nabcde");
});

test("清理超过保留窗口的字幕", () => {
  const buffer = new SubtitleBuffer({ retentionSeconds: 60 });
  buffer.add(1, "过期");
  buffer.add(62, "保留");

  assert.equal(buffer.before(62, { seconds: 60, maxChars: 500 }), "保留");
});

