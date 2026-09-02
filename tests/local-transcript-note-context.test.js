import assert from "node:assert/strict";
import test from "node:test";

import { localTranscriptNoteContext } from "../src/core/local-transcript-note-context.js";

const context = {
  platform: "youtube",
  sessionId: "youtube:video-1",
  videoId: "video-1",
};

function source(groups) {
  return {
    sessionId: context.sessionId,
    videoId: context.videoId,
    groups,
  };
}

test("本地字幕按前置时间窗口选择完整分段并允许跨过标记时点", () => {
  const result = localTranscriptNoteContext({
    context,
    source: source([
      { startMs: 0, endMs: 7000, text: "第一段", translation: "First" },
      { startMs: 7000, endMs: 12000, text: "第二段", translation: "Second" },
      { startMs: 12000, endMs: 22000, text: "第三段", translation: "Third" },
    ]),
    markerSeconds: 18,
    windowSeconds: 10,
  });

  assert.deepEqual(result, {
    subtitleContext: "第二段\n第三段",
    subtitleTranslation: "Second\nThird",
  });
});

test("范围内存在未翻译分段时只保存完整原文", () => {
  const result = localTranscriptNoteContext({
    context,
    source: source([
      { startMs: 5000, endMs: 12000, text: "已有译文", translation: "Translated" },
      { startMs: 12000, endMs: 22000, text: "尚未翻译" },
    ]),
    markerSeconds: 18,
    windowSeconds: 20,
  });

  assert.deepEqual(result, {
    subtitleContext: "已有译文\n尚未翻译",
    subtitleTranslation: "",
  });
});

test("创建笔记时优先使用请求携带的最新译文而不是旧同步快照", () => {
  const staleSource = source([
    { startMs: 0, endMs: 12000, text: "原文" },
  ]);
  const freshSource = source([
    { startMs: 0, endMs: 12000, text: "原文", translation: "Translation" },
  ]);

  assert.deepEqual(localTranscriptNoteContext({
    context,
    source: staleSource,
    preferredSource: freshSource,
    markerSeconds: 10,
    windowSeconds: 20,
  }), {
    subtitleContext: "原文",
    subtitleTranslation: "Translation",
  });
});

test("字符限制从最早分段开始丢弃但不拆开完整分段", () => {
  const result = localTranscriptNoteContext({
    context,
    source: source([
      { startMs: 0, endMs: 5000, text: "aaaaaa", translation: "AAAAAA" },
      { startMs: 5000, endMs: 10000, text: "bbbbbb", translation: "BBBBBB" },
      { startMs: 10000, endMs: 15000, text: "cccccc", translation: "CCCCCC" },
    ]),
    markerSeconds: 15,
    windowSeconds: 20,
    maxChars: 13,
  });

  assert.deepEqual(result, {
    subtitleContext: "bbbbbb\ncccccc",
    subtitleTranslation: "BBBBBB\nCCCCCC",
  });
});

test("单个完整分段超过限制时仍完整保留", () => {
  const text = "完整长句".repeat(20);
  assert.deepEqual(localTranscriptNoteContext({
    context,
    source: source([{ startMs: 0, endMs: 12000, text, translation: "Whole sentence" }]),
    markerSeconds: 10,
    windowSeconds: 5,
    maxChars: 10,
  }), {
    subtitleContext: text,
    subtitleTranslation: "Whole sentence",
  });
});

test("本地字幕身份、平台或覆盖范围无效时返回空结果供画面字幕回退", () => {
  const groups = [{ startMs: 0, endMs: 5000, text: "字幕" }];
  assert.equal(localTranscriptNoteContext({
    context: { ...context, videoId: "video-2" },
    source: source(groups),
    markerSeconds: 3,
    windowSeconds: 5,
  }), null);
  assert.equal(localTranscriptNoteContext({
    context: { ...context, platform: "bilibili" },
    source: source(groups),
    markerSeconds: 3,
    windowSeconds: 5,
  }), null);
  assert.equal(localTranscriptNoteContext({
    context,
    source: source(groups),
    markerSeconds: 6,
    windowSeconds: 20,
  }), null);
  assert.equal(localTranscriptNoteContext({
    context,
    source: source(groups),
    markerSeconds: 30,
    windowSeconds: 5,
  }), null);
});

test("关闭前置字幕或传入非法时间时不使用本地字幕", () => {
  const transcriptSource = source([{ startMs: 0, endMs: 5000, text: "字幕" }]);
  assert.equal(localTranscriptNoteContext({
    context,
    source: transcriptSource,
    markerSeconds: 3,
    windowSeconds: 5,
    enabled: false,
  }), null);
  assert.equal(localTranscriptNoteContext({
    context,
    source: transcriptSource,
    markerSeconds: Number.NaN,
    windowSeconds: 5,
  }), null);
});
