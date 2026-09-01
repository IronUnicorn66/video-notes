import assert from "node:assert/strict";
import test from "node:test";

import {
  formatSubtitleFragments,
  subtitleBoundaryStrength,
  truncateSubtitleText,
} from "../src/core/subtitle-segmentation.js";

test("字幕断句识别中英文强标点和尾随引号括号", () => {
  for (const text of [
    "Done.",
    "Really?",
    "Stop!",
    "完成。",
    "真的吗？",
    "停下！",
    "稍后再说……",
    "结束。’）",
  ]) {
    assert.equal(subtitleBoundaryStrength(text), "strong", text);
  }
});

test("字幕断句将逗号分号冒号顿号视为弱标点", () => {
  for (const text of ["first,", "其次；", "说明：", "苹果、", "继续，”"]) {
    assert.equal(subtitleBoundaryStrength(text), "weak", text);
  }
  assert.equal(subtitleBoundaryStrength("still speaking"), null);
  assert.equal(subtitleBoundaryStrength(""), null);
});

test("连续字幕折叠滚动扩展并按完整句整理成段", () => {
  assert.equal(formatSubtitleFragments([
    "We are",
    "We are learning.",
    "Next",
    "part? Still unfinished",
  ]), "We are learning.\nNext part?\nStill unfinished");
  assert.equal(
    formatSubtitleFragments(["We are learning", "are learning how it works."]),
    "We are learning how it works.",
  );
  assert.equal(
    formatSubtitleFragments(["我们正在学习", "正在学习断句。"]),
    "我们正在学习断句。",
  );
});

test("很短的滚动字幕片段扩展时不会重复保留前缀", () => {
  assert.equal(
    formatSubtitleFragments(["I", "I am learning."]),
    "I am learning.",
  );
});

test("字幕整理保留窗口首尾残句和原有换行", () => {
  assert.equal(formatSubtitleFragments([
    "中间残句",
    "继续。末尾残句",
  ]), "中间残句继续。\n末尾残句");
  assert.equal(
    formatSubtitleFragments(["source line\ntranslation line"]),
    "source line\ntranslation line",
  );
});

test("字幕超长时优先从靠近限制的标点后开始保留", () => {
  assert.equal(
    truncateSubtitleText("old fragment, useful sentence. newest fragment", 35),
    "useful sentence. newest fragment",
  );
  assert.equal(truncateSubtitleText("1234567890", 5), "67890");
});
