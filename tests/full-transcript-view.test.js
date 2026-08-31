import assert from "node:assert/strict";
import test from "node:test";

import * as transcriptView from "../src/core/full-transcript-view.js";

const {
  filterTranscriptCues,
  transcriptFailureMessageKey,
} = transcriptView;

const cues = [
  { startMs: 5000, endMs: 7000, text: "Welcome to CS329A" },
  { startMs: 8000, endMs: 10000, text: "Self-improving AI agents" },
  { startMs: 11000, endMs: 13000, text: "课程概览" },
];

test("完整字幕搜索忽略大小写和首尾空格", () => {
  assert.deepEqual(
    filterTranscriptCues(cues, "  AI AGENTS  "),
    [cues[1]],
  );
  assert.deepEqual(filterTranscriptCues(cues, "课程"), [cues[2]]);
  assert.deepEqual(filterTranscriptCues(cues, "   "), cues);
});

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

test("搜索完整字幕时保留逐条匹配而不合并", () => {
  assert.deepEqual(
    transcriptView.transcriptDisplayCues(cues, "AI", { grouped: true }),
    { grouped: false, cues: [cues[1]] },
  );
  assert.deepEqual(
    transcriptView.transcriptDisplayCues(cues, "", { grouped: true }),
    {
      grouped: true,
      cues: transcriptView.groupTranscriptCues(cues),
    },
  );
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
