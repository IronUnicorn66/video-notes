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
        baseUrl: "https://www.youtube.com/api/timedtext?v=video-id&track=auto",
        languageCode: "en",
        kind: "asr",
        name: { simpleText: "English (auto-generated)" },
      },
      {
        baseUrl: "https://www.youtube.com/api/timedtext?v=video-id&track=manual",
        languageCode: "en",
        name: { runs: [{ text: "English" }, { text: " - CC" }] },
      },
    ]),
  ], [], "video-id");

  assert.equal(tracks.length, 2);
  assert.deepEqual(tracks.map(({ label, automatic }) => ({ label, automatic })), [
    { label: "English - CC", automatic: false },
    { label: "English (auto-generated)", automatic: true },
  ]);
});

test("YouTube SPA 跳转后只选择当前视频的字幕轨道", () => {
  const tracks = extractYoutubeCaptionTracks([
    playerResponseScript([{
      baseUrl: "https://www.youtube.com/api/timedtext?v=old-video&lang=en",
      languageCode: "en",
      name: { simpleText: "Old" },
    }]),
    playerResponseScript([{
      baseUrl: "https://www.youtube.com/api/timedtext?v=current-video&lang=en",
      languageCode: "en",
      name: { simpleText: "Current" },
    }]),
  ], [], "current-video");

  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].label, "Current");
  assert.match(tracks[0].baseUrl, /[?&]v=current-video(?:&|$)/);
});

test("完整字幕只读取当前视频的 YouTube HTTPS timedtext 轨道", async () => {
  const scripts = [
    playerResponseScript([{
      baseUrl: "https://www.youtube.com/api/timedtext?v=old-video&lang=en",
      languageCode: "en",
      name: { simpleText: "Old" },
    }]),
    playerResponseScript([{
      baseUrl: "https://www.youtube.com/api/timedtext?v=current-video&lang=en",
      languageCode: "en",
      name: { simpleText: "Current" },
    }]),
  ];
  const requestedUrls = [];
  const result = await readYoutubeFullTranscript({ scripts }, {
    videoId: "current-video",
    fetchImpl: async (url) => {
      requestedUrls.push(url);
      const text = new URL(url).searchParams.get("v");
      return textResponse(JSON.stringify({
        events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: text }] }],
      }));
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.videoId, "current-video");
  assert.equal(result.cues[0].text, "current-video");
  assert.ok(requestedUrls.every((url) => new URL(url).searchParams.get("v") === "current-video"));
});

test("原生轨道拒绝外域、非 HTTPS、缺失 v 和错误 v", async () => {
  for (const baseUrl of [
    "https://example.invalid/api/timedtext?v=current-video&lang=en",
    "http://www.youtube.com/api/timedtext?v=current-video&lang=en",
    "https://www.youtube.com/api/timedtext?lang=en",
    "https://www.youtube.com/api/timedtext?v=old-video&lang=en",
    "https://www.youtube.com/not-timedtext?v=current-video&lang=en",
  ]) {
    let fetchCount = 0;
    const result = await readYoutubeFullTranscript(transcriptRoot([{
      baseUrl,
      languageCode: "en",
      name: { simpleText: "English" },
    }]), {
      videoId: "current-video",
      fetchImpl: async () => {
        fetchCount += 1;
        return textResponse(JSON.stringify({
          events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "wrong" }] }],
        }));
      },
    });

    assert.deepEqual(result, {
      ok: false,
      code: "YOUTUBE_CAPTION_TRACKS_MISSING",
      trackCount: 0,
      videoId: "current-video",
    });
    assert.equal(fetchCount, 0);
  }
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

test("解析 YouTube JSON3 时丢弃异常结构和非法时间", () => {
  assert.deepEqual(parseYoutubeJson3Transcript('{"events":{}}'), []);
  assert.deepEqual(parseYoutubeJson3Transcript(JSON.stringify({
    events: [
      { tStartMs: -1, dDurationMs: 1000, segs: [{ utf8: "negative start" }] },
      { tStartMs: 0, dDurationMs: -1, segs: [{ utf8: "negative duration" }] },
      { tStartMs: "invalid", dDurationMs: 1000, segs: [{ utf8: "not finite" }] },
      { tStartMs: 0, dDurationMs: 1000, segs: {} },
      { tStartMs: 1000, dDurationMs: 500, segs: [{ utf8: "valid" }] },
    ],
  })), [
    { startMs: 1000, endMs: 1500, text: "valid" },
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

test("解析 YouTube XML 时丢弃非法时间", () => {
  const cues = parseYoutubeXmlTranscript(
    '<transcript><text start="-1" dur="1">negative</text><text start="bad" dur="1">invalid</text><text start="2" dur="-1">duration</text><text start="3" dur="1">valid</text></transcript>',
  );

  assert.deepEqual(cues, [
    { startMs: 3000, endMs: 4000, text: "valid" },
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
    videoId: "example",
    fetchImpl: async (url, options) => {
      requestedUrls.push({ url, options });
      return textResponse(JSON.stringify({
        events: [{ tStartMs: 5000, dDurationMs: 900, segs: [{ utf8: "完整字幕" }] }],
      }));
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.source, "youtube-native-caption-track");
  assert.equal(result.videoId, "example");
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
    videoId: "example",
    fetchImpl: async () => textResponse(""),
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "YOUTUBE_NATIVE_CAPTION_BLOCKED");
  assert.equal(result.trackCount, 1);
  assert.ok(result.attempts.every((attempt) => attempt.byteLength === 0));
});

test("页面没有暴露字幕轨道时返回明确状态", async () => {
  const result = await readYoutubeFullTranscript({ scripts: [] }, {
    videoId: "example",
    fetchImpl: async () => {
      throw new Error("不应发起请求");
    },
  });

  assert.deepEqual(result, {
    ok: false,
    code: "YOUTUBE_CAPTION_TRACKS_MISSING",
    trackCount: 0,
    videoId: "example",
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
