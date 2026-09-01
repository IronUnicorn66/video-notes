import assert from "node:assert/strict";
import test from "node:test";
import * as youtubeTranscript from "../src/core/youtube-full-transcript.js";

import {
  extractYoutubeCaptionTracks,
  parseYoutubeJson3Transcript,
  parseYoutubeXmlTranscript,
  readYoutubeFullTranscript,
} from "../src/core/youtube-full-transcript.js";

function playerResponseScript(captionTracks) {
  return {
    textContent: `var ytInitialPlayerResponse = ${JSON.stringify({
      captions: {
        playerCaptionsTracklistRenderer: { captionTracks },
      },
    })};`,
  };
}

function transcriptRoot(captionTracks) {
  return { scripts: [playerResponseScript(captionTracks)] };
}

function textResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  };
}

test("从 YouTube 页面数据发现完整字幕轨道并优先人工字幕", () => {
  const tracks = extractYoutubeCaptionTracks([
    playerResponseScript([
      {
        baseUrl: "https://www.youtube.com/api/timedtext?track=auto",
        languageCode: "en",
        kind: "asr",
        name: { simpleText: "English (auto-generated)" },
      },
      {
        baseUrl: "https://www.youtube.com/api/timedtext?track=manual",
        languageCode: "en",
        name: { runs: [{ text: "English" }, { text: " - CC" }] },
      },
    ]),
  ]);

  assert.equal(tracks.length, 2);
  assert.deepEqual(tracks.map(({ label, automatic }) => ({ label, automatic })), [
    { label: "English - CC", automatic: false },
    { label: "English (auto-generated)", automatic: true },
  ]);
});

test("解析 YouTube JSON3 完整字幕并忽略无文本事件", () => {
  const cues = parseYoutubeJson3Transcript(JSON.stringify({
    events: [
      { tStartMs: 5000, dDurationMs: 1800, segs: [{ utf8: "Welcome, " }, { utf8: "everyone." }] },
      { tStartMs: 6800, dDurationMs: 300 },
      { tStartMs: 7100, dDurationMs: 900, segs: [{ utf8: "Thanks, everyone." }] },
    ],
  }));

  assert.deepEqual(cues, [
    { startMs: 5000, endMs: 6800, text: "Welcome, everyone." },
    { startMs: 7100, endMs: 8000, text: "Thanks, everyone." },
  ]);
});

test("解析 YouTube XML 完整字幕并还原实体", () => {
  const cues = parseYoutubeXmlTranscript(
    '<transcript><text start="0.5" dur="1.25">A &amp; B</text><text start="2">第二句</text></transcript>',
  );

  assert.deepEqual(cues, [
    { startMs: 500, endMs: 1750, text: "A & B" },
    { startMs: 2000, endMs: 2000, text: "第二句" },
  ]);
});

test("原生字幕读取成功时返回来源、语言和全部字幕", async () => {
  const requestedUrls = [];
  const result = await readYoutubeFullTranscript(transcriptRoot([
    {
      baseUrl: "https://www.youtube.com/api/timedtext?v=example&lang=en",
      languageCode: "en",
      name: { simpleText: "English" },
    },
  ]), {
    fetchImpl: async (url, options) => {
      requestedUrls.push({ url, options });
      return textResponse(JSON.stringify({
        events: [{ tStartMs: 5000, dDurationMs: 900, segs: [{ utf8: "完整字幕" }] }],
      }));
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.source, "youtube-native-caption-track");
  assert.equal(result.languageCode, "en");
  assert.equal(result.cues.length, 1);
  assert.match(requestedUrls[0].url, /[?&]fmt=json3(?:&|$)/);
  assert.equal(requestedUrls[0].options.credentials, "include");
});

test("有字幕轨道但平台返回空内容时报告受限而不是没有字幕", async () => {
  const result = await readYoutubeFullTranscript(transcriptRoot([
    {
      baseUrl: "https://www.youtube.com/api/timedtext?v=example&lang=en",
      languageCode: "en",
      name: { simpleText: "English" },
    },
  ]), {
    fetchImpl: async () => textResponse(""),
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "YOUTUBE_NATIVE_CAPTION_BLOCKED");
  assert.equal(result.trackCount, 1);
  assert.ok(result.attempts.every((attempt) => attempt.byteLength === 0));
});

test("页面没有暴露字幕轨道时返回明确状态", async () => {
  const result = await readYoutubeFullTranscript({ scripts: [] }, {
    fetchImpl: async () => {
      throw new Error("不应发起请求");
    },
  });

  assert.deepEqual(result, {
    ok: false,
    code: "YOUTUBE_CAPTION_TRACKS_MISSING",
    trackCount: 0,
  });
});

test("字幕轨道缺失或受限时都会尝试播放器字幕捕获", () => {
  assert.equal(
    typeof youtubeTranscript.shouldAttemptYoutubePlayerCapture,
    "function",
  );
  assert.equal(
    youtubeTranscript.shouldAttemptYoutubePlayerCapture({ code: "YOUTUBE_CAPTION_TRACKS_MISSING" }),
    true,
  );
  assert.equal(
    youtubeTranscript.shouldAttemptYoutubePlayerCapture({ code: "YOUTUBE_NATIVE_CAPTION_BLOCKED" }),
    true,
  );
  assert.equal(
    youtubeTranscript.shouldAttemptYoutubePlayerCapture({ code: "YOUTUBE_PLAYER_CAPTURE_FAILED" }),
    false,
  );
});
