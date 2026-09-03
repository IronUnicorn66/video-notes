import assert from "node:assert/strict";
import test from "node:test";

import {
  localTranscriptNoteContext,
  preferredNoteSubtitleContext,
} from "../src/core/local-transcript-note-context.js";

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
    context: { ...context, platform: "vimeo" },
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

test("B 站本地字幕轨道可按笔记时间窗口提供回退内容", () => {
  const bilibiliContext = {
    platform: "bilibili",
    sessionId: "bilibili:BV1example:1",
    videoId: "BV1example",
  };
  const result = localTranscriptNoteContext({
    context: bilibiliContext,
    source: {
      sessionId: bilibiliContext.sessionId,
      videoId: bilibiliContext.videoId,
      groups: [
        { startMs: 0, endMs: 7000, text: "范围外" },
        { startMs: 8000, endMs: 14000, text: "前一句" },
        { startMs: 14000, endMs: 22000, text: "当前句" },
      ],
    },
    markerSeconds: 18,
    windowSeconds: 10,
  });

  assert.deepEqual(result, {
    subtitleContext: "前一句\n当前句",
    subtitleTranslation: "",
  });
});

test("B 站优先保留页面已渲染的双语字幕", () => {
  assert.deepEqual(preferredNoteSubtitleContext({
    platform: "bilibili",
    renderedText: "页面原文\n页面译文",
    localSubtitles: {
      subtitleContext: "原生字幕轨",
      subtitleTranslation: "",
    },
  }), {
    subtitleContext: "页面原文\n页面译文",
    subtitleTranslation: "",
  });
});

test("B 站页面未渲染字幕时回退到原生字幕轨", () => {
  assert.deepEqual(preferredNoteSubtitleContext({
    platform: "bilibili",
    renderedText: "",
    localSubtitles: {
      subtitleContext: "原生字幕轨",
      subtitleTranslation: "",
    },
  }), {
    subtitleContext: "原生字幕轨",
    subtitleTranslation: "",
  });
});

test("YouTube 继续优先使用完整字幕源及其译文", () => {
  assert.deepEqual(preferredNoteSubtitleContext({
    platform: "youtube",
    renderedText: "页面字幕",
    localSubtitles: {
      subtitleContext: "完整字幕",
      subtitleTranslation: "Translation",
    },
  }), {
    subtitleContext: "完整字幕",
    subtitleTranslation: "Translation",
  });
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
