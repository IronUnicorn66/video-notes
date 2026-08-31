import assert from "node:assert/strict";
import test from "node:test";

import {
  filterTranscriptCues,
  transcriptFailureMessageKey,
} from "../src/core/full-transcript-view.js";

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
