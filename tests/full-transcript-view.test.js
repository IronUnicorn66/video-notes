import assert from "node:assert/strict";
import test from "node:test";

import * as transcriptView from "../src/core/full-transcript-view.js";

const {
  transcriptFailureMessageKey,
} = transcriptView;

const cues = [
  { startMs: 5000, endMs: 7000, text: "Welcome to CS329A" },
  { startMs: 8000, endMs: 10000, text: "Self-improving AI agents" },
  { startMs: 11000, endMs: 13000, text: "课程概览" },
];

test("完整字幕状态提供第一条开始至最后一条结束的覆盖范围", () => {
  assert.deepEqual(
    transcriptView.transcriptCoverage(cues),
    { startMs: 5000, endMs: 13000 },
  );
  assert.equal(transcriptView.transcriptCoverage([]), null);
});

test("完整字幕时间范围省略不足一小时的小时前导零", () => {
  assert.equal(
    transcriptView.formatTranscriptTimeRange({ startMs: 5000, endMs: 4175000 }),
    "00:05–01:09:35",
  );
});

test("完整字幕按五条合并，末组保留剩余字幕和完整时间范围", () => {
  const grouped = transcriptView.groupTranscriptCues([
    ...cues,
    { startMs: 14000, endMs: 16000, text: "第四条" },
    { startMs: 17000, endMs: 19000, text: "第五条" },
    { startMs: 20000, endMs: 22000, text: "第六条" },
  ]);

  assert.deepEqual(grouped, [
    {
      startMs: 5000,
      endMs: 19000,
      text: "Welcome to CS329A Self-improving AI agents 课程概览 第四条 第五条",
    },
    { startMs: 20000, endMs: 22000, text: "第六条" },
  ]);
});

test("完整字幕只接受三个合并档位并回退到默认五条", () => {
  assert.equal(transcriptView.normalizeTranscriptGroupSize(5), 5);
  assert.equal(transcriptView.normalizeTranscriptGroupSize("10"), 10);
  assert.equal(transcriptView.normalizeTranscriptGroupSize(20), 20);
  assert.equal(transcriptView.normalizeTranscriptGroupSize(30), 5);
  assert.equal(transcriptView.normalizeTranscriptGroupSize(15), 5);
  assert.equal(transcriptView.normalizeTranscriptGroupSize("invalid"), 5);
});

test("完整字幕翻译进度按总数位数预留固定空间", () => {
  const progressValues = [
    transcriptView.formatTranscriptProgress(9, 1081),
    transcriptView.formatTranscriptProgress(10, 1081),
    transcriptView.formatTranscriptProgress(100, 1081),
    transcriptView.formatTranscriptProgress(1081, 1081),
  ];

  assert.deepEqual(progressValues, [
    "\u2007\u2007\u20079/1081",
    "\u2007\u200710/1081",
    "\u2007100/1081",
    "1081/1081",
  ]);
  assert.deepEqual(progressValues.map((value) => [...value].length), [9, 9, 9, 9]);
});

test("完整字幕按自定义条数合并并拼接已有译文", () => {
  const grouped = transcriptView.groupTranscriptCues([
    { ...cues[0], translation: "欢迎来到 CS329A" },
    { ...cues[1], translation: "自我改进的 AI 智能体" },
    { ...cues[2], translation: "课程概览" },
  ], 2);

  assert.deepEqual(grouped, [
    {
      startMs: 5000,
      endMs: 10000,
      text: "Welcome to CS329A Self-improving AI agents",
      translation: "欢迎来到 CS329A 自我改进的 AI 智能体",
    },
    {
      startMs: 11000,
      endMs: 13000,
      text: "课程概览",
      translation: "课程概览",
    },
  ]);
});

test("完整字幕分组合并不会把部分译文当作完整译文展示", () => {
  const grouped = transcriptView.groupTranscriptCues([
    { ...cues[0], translation: "欢迎来到 CS329A" },
    { ...cues[1], translation: "自我改进的 AI 智能体" },
    cues[2],
  ], 3);

  assert.deepEqual(grouped, [{
    startMs: 5000,
    endMs: 13000,
    text: "Welcome to CS329A Self-improving AI agents 课程概览",
  }]);
});

test("完整字幕失败状态映射为可理解文案", () => {
  assert.equal(
    transcriptFailureMessageKey({ code: "YOUTUBE_CAPTION_TRACKS_MISSING" }),
    "fullTranscriptMissing",
  );
  assert.equal(
    transcriptFailureMessageKey({
      code: "YOUTUBE_NATIVE_CAPTION_BLOCKED",
      playerCaptureCode: "YOUTUBE_PLAYER_CAPTION_NOT_OBSERVED",
    }),
    "fullTranscriptNotObserved",
  );
  assert.equal(
    transcriptFailureMessageKey({ code: "YOUTUBE_NATIVE_CAPTION_BLOCKED" }),
    "fullTranscriptBlocked",
  );
});
