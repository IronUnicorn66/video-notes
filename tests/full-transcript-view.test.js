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

test("播放器时间定位到当前字幕段或相邻边界段", () => {
  const groups = [
    { startMs: 5000, endMs: 10000 },
    { startMs: 12000, endMs: 18000 },
    { startMs: 20000, endMs: 26000 },
  ];

  assert.equal(transcriptView.transcriptGroupIndexAtTime(groups, 7), 0);
  assert.equal(transcriptView.transcriptGroupIndexAtTime(groups, 11), 0);
  assert.equal(transcriptView.transcriptGroupIndexAtTime(groups, 12), 1);
  assert.equal(transcriptView.transcriptGroupIndexAtTime(groups, 0), 0);
  assert.equal(transcriptView.transcriptGroupIndexAtTime(groups, 30), 2);
  assert.equal(transcriptView.transcriptGroupIndexAtTime([], 10), -1);
  assert.equal(transcriptView.transcriptGroupIndexAtTime(groups, -1), -1);
  assert.equal(transcriptView.transcriptGroupIndexAtTime(groups, Number.NaN), -1);
});

test("完整字幕定位在不同侧栏缩放下都一次跳到目标中心", () => {
  const expected = 3740;
  for (const scale of [0.75, 1, 2]) {
    assert.equal(transcriptView.centeredTranscriptScrollTop({
      currentScrollTop: 1000,
      listTop: 100 * scale,
      listHeight: 600 * scale,
      cueTop: 3100 * scale,
      cueHeight: 80 * scale,
      coordinateScale: scale,
    }), expected);
  }
});

test("完整字幕时间范围省略不足一小时的小时前导零", () => {
  assert.equal(
    transcriptView.formatTranscriptTimeRange({ startMs: 5000, endMs: 4175000 }),
    "00:05–01:09:35",
  );
});

test("完整字幕从目标条数开始延伸到强断句点", () => {
  const grouped = transcriptView.groupTranscriptCues([
    ...cues,
    { startMs: 14000, endMs: 16000, text: "第四条" },
    { startMs: 17000, endMs: 19000, text: "第五条" },
    { startMs: 20000, endMs: 22000, text: "第六条。" },
    { startMs: 23000, endMs: 25000, text: "第七条" },
  ]);

  assert.deepEqual(grouped, [
    {
      id: "0:6",
      sourceStartIndex: 0,
      sourceEndIndex: 5,
      startMs: 5000,
      endMs: 22000,
      text: "Welcome to CS329A Self-improving AI agents 课程概览 第四条 第五条 第六条。",
    },
    {
      id: "6:7",
      sourceStartIndex: 6,
      sourceEndIndex: 6,
      startMs: 23000,
      endMs: 25000,
      text: "第七条",
    },
  ]);
});

test("完整字幕两倍范围内没有句末时回退到最后一个弱断句点", () => {
  const input = Array.from({ length: 12 }, (_, index) => ({
    startMs: index * 1000,
    endMs: (index + 1) * 1000,
    text: index === 8 ? `第 ${index + 1} 条，` : `第 ${index + 1} 条`,
  }));

  assert.deepEqual(
    transcriptView.groupTranscriptCues(input, 5).map((group) => [
      group.sourceStartIndex,
      group.sourceEndIndex,
    ]),
    [[0, 8], [9, 11]],
  );
});

test("完整字幕没有任何标点时在两倍目标条数处强制切分", () => {
  const input = Array.from({ length: 23 }, (_, index) => ({
    startMs: index * 1000,
    endMs: (index + 1) * 1000,
    text: `cue ${index + 1}`,
  }));

  assert.deepEqual(
    transcriptView.groupTranscriptCues(input, 5).map((group) => [
      group.sourceStartIndex,
      group.sourceEndIndex,
    ]),
    [[0, 9], [10, 19], [20, 22]],
  );
});

test("完整字幕只接受三个合并档位并回退到默认五条", () => {
  assert.equal(transcriptView.normalizeTranscriptGroupSize(5), 5);
  assert.equal(transcriptView.normalizeTranscriptGroupSize("10"), 10);
  assert.equal(transcriptView.normalizeTranscriptGroupSize(20), 20);
  assert.equal(transcriptView.normalizeTranscriptGroupSize(30), 5);
  assert.equal(transcriptView.normalizeTranscriptGroupSize(15), 5);
  assert.equal(transcriptView.normalizeTranscriptGroupSize("invalid"), 5);
});

test("完整字幕字号按一像素调整并限制在 10 到 24 像素", () => {
  assert.equal(transcriptView.normalizeTranscriptFontSize(undefined), 12);
  assert.equal(transcriptView.normalizeTranscriptFontSize("invalid"), 12);
  assert.equal(transcriptView.normalizeTranscriptFontSize(8), 10);
  assert.equal(transcriptView.normalizeTranscriptFontSize("16"), 16);
  assert.equal(transcriptView.normalizeTranscriptFontSize(30), 24);
  assert.equal(transcriptView.transcriptFontSizeAfterStep(12, -1), 11);
  assert.equal(transcriptView.transcriptFontSizeAfterStep(12, 1), 13);
  assert.equal(transcriptView.transcriptFontSizeAfterStep(10, -1), 10);
  assert.equal(transcriptView.transcriptFontSizeAfterStep(24, 1), 24);
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

test("完整字幕分组使用稳定范围标识并可读取整段译文", () => {
  const translations = new Map([
    ["0:2", "欢迎来到 CS329A。自我改进的 AI 智能体。"],
  ]);
  const grouped = transcriptView.groupTranscriptCues([
    { ...cues[0], text: "Welcome to CS329A." },
    { ...cues[1], text: "Self-improving AI agents." },
    { ...cues[2], translation: "课程概览" },
  ], 2, translations);

  assert.deepEqual(grouped, [
    {
      id: "0:2",
      sourceStartIndex: 0,
      sourceEndIndex: 1,
      startMs: 5000,
      endMs: 10000,
      text: "Welcome to CS329A. Self-improving AI agents.",
      translation: "欢迎来到 CS329A。自我改进的 AI 智能体。",
    },
    {
      id: "2:3",
      sourceStartIndex: 2,
      sourceEndIndex: 2,
      startMs: 11000,
      endMs: 13000,
      text: "课程概览",
    },
  ]);
});

test("完整字幕翻译缓存可在切换合并档位后恢复", () => {
  const input = Array.from({ length: 14 }, (_, index) => ({
    startMs: index * 1000,
    endMs: (index + 1) * 1000,
    text: [5, 11, 13].includes(index) ? `cue ${index + 1}.` : `cue ${index + 1}`,
  }));
  const translations = new Map([["0:6", "第一段译文"]]);

  const five = transcriptView.groupTranscriptCues(input, 5, translations);
  const ten = transcriptView.groupTranscriptCues(input, 10, translations);
  const fiveAgain = transcriptView.groupTranscriptCues(input, 5, translations);

  assert.equal(five[0].translation, "第一段译文");
  assert.equal(ten[0].translation, undefined);
  assert.equal(fiveAgain[0].translation, "第一段译文");
});

test("完整字幕不会继续拼接旧的逐条译文", () => {
  const grouped = transcriptView.groupTranscriptCues([
    { ...cues[0], translation: "欢迎来到 CS329A" },
    { ...cues[1], translation: "自我改进的 AI 智能体" },
    cues[2],
  ], 3);

  assert.deepEqual(grouped, [{
    id: "0:3",
    sourceStartIndex: 0,
    sourceEndIndex: 2,
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
