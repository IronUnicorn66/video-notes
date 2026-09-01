import assert from "node:assert/strict";
import test from "node:test";

import { captureYoutubePlayerTranscript } from "../src/core/youtube-transcript-capture.js";
import {
  transcriptFromYoutubeCapture,
  transcriptResultAfterPlayerCapture,
} from "../src/core/youtube-full-transcript.js";

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    clone: () => response(body, status),
    text: async () => body,
  };
}

function pageRuntime({
  resourceUrls = [],
  fetchImpl,
  initiallyPressed = false,
  captionUrl = "https://www.youtube.com/api/timedtext?v=video-id&lang=en&fmt=json3&pot=proof",
} = {}) {
  let pressed = initiallyPressed;
  let clickCount = 0;
  const button = {
    getAttribute: (name) => name === "aria-pressed" ? String(pressed) : null,
    click: () => {
      pressed = !pressed;
      clickCount += 1;
      if (pressed && captionUrl) void runtime.window.fetch(captionUrl);
    },
  };
  const runtime = {
    document: { querySelector: () => button },
    window: {
      clearTimeout,
      fetch: fetchImpl ?? (async () => response("")),
      location: { href: "https://www.youtube.com/watch?v=video-id" },
      performance: {
        getEntriesByType: () => resourceUrls.map((name) => ({ name })),
      },
      setTimeout,
    },
    wait: async () => {},
  };
  return {
    runtime,
    state: () => ({ pressed, clickCount }),
  };
}

test("优先复用播放器已经请求过的带证明字幕地址", async () => {
  const signedUrl = "https://www.youtube.com/api/timedtext?v=video-id&lang=en&fmt=json3&pot=proof";
  const { runtime, state } = pageRuntime({
    resourceUrls: [signedUrl],
    fetchImpl: async () => response('{"events":[{"tStartMs":0,"segs":[{"utf8":"完整字幕"}]}]}'),
  });

  const result = await captureYoutubePlayerTranscript(100, runtime);

  assert.equal(result.ok, true);
  assert.equal(result.transport, "performance-entry");
  assert.equal(result.url, signedUrl);
  assert.match(result.body, /完整字幕/);
  assert.deepEqual(state(), { pressed: false, clickCount: 0 });
});

test("播放器捕获拒绝外域、非 HTTPS、缺失 v、错误 v 和错误路径", async () => {
  for (const invalidUrl of [
    "https://example.invalid/api/timedtext?v=video-id&lang=en",
    "http://www.youtube.com/api/timedtext?v=video-id&lang=en",
    "https://www.youtube.com/api/timedtext?lang=en",
    "https://www.youtube.com/api/timedtext?v=old-video&lang=en",
    "https://www.youtube.com/not-timedtext?v=video-id&lang=en",
  ]) {
    let fetchCount = 0;
    const { runtime, state } = pageRuntime({
      resourceUrls: [invalidUrl],
      captionUrl: null,
      fetchImpl: async () => {
        fetchCount += 1;
        return response('{"events":[{"tStartMs":0,"segs":[{"utf8":"wrong"}]}]}');
      },
    });

    const result = await captureYoutubePlayerTranscript(1, runtime);

    assert.deepEqual(result, { ok: false, code: "YOUTUBE_PLAYER_CAPTION_NOT_OBSERVED" });
    assert.equal(fetchCount, 0);
    assert.deepEqual(state(), { pressed: false, clickCount: 2 });
  }
});

test("监听字幕开关触发的响应并恢复原关闭状态", async () => {
  const originalFetch = async () => response(
    '{"events":[{"tStartMs":5000,"dDurationMs":1000,"segs":[{"utf8":"Welcome"}]}]}',
  );
  const { runtime, state } = pageRuntime({ fetchImpl: originalFetch });

  const result = await captureYoutubePlayerTranscript(100, runtime);

  assert.equal(result.ok, true);
  assert.equal(result.transport, "fetch");
  assert.equal(runtime.window.fetch, originalFetch);
  assert.deepEqual(state(), { pressed: false, clickCount: 2 });
});

test("没有捕获到正文时返回明确状态并恢复字幕", async () => {
  const originalFetch = async () => response("");
  const { runtime, state } = pageRuntime({ fetchImpl: originalFetch });

  const result = await captureYoutubePlayerTranscript(1, runtime);

  assert.deepEqual(result, { ok: false, code: "YOUTUBE_PLAYER_CAPTION_NOT_OBSERVED" });
  assert.equal(runtime.window.fetch, originalFetch);
  assert.deepEqual(state(), { pressed: false, clickCount: 2 });
});

test("重叠捕获串行执行并恢复页面网络方法", async () => {
  const originalFetch = async () => response(
    '{"events":[{"tStartMs":5000,"dDurationMs":1000,"segs":[{"utf8":"Welcome"}]}]}',
  );
  const { runtime, state } = pageRuntime({ fetchImpl: originalFetch });

  const [first, second] = await Promise.all([
    captureYoutubePlayerTranscript(100, runtime),
    captureYoutubePlayerTranscript(100, runtime),
  ]);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(runtime.window.fetch, originalFetch);
  assert.deepEqual(state(), { pressed: false, clickCount: 4 });
});

test("把捕获到的字幕正文转换为完整字幕结果且不暴露签名地址", () => {
  const result = transcriptFromYoutubeCapture({
    ok: true,
    url: "https://www.youtube.com/api/timedtext?v=video-id&lang=en&kind=asr&fmt=json3&pot=secret",
    body: '{"events":[{"tStartMs":5000,"dDurationMs":1000,"segs":[{"utf8":"Welcome"}]}]}',
  }, "video-id");

  assert.deepEqual(result, {
    ok: true,
    source: "youtube-player-caption-response",
    videoId: "video-id",
    languageCode: "en",
    label: "en",
    automatic: true,
    cues: [{ startMs: 5000, endMs: 6000, text: "Welcome" }],
  });
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("捕获结果拒绝外域、缺失 v 和错误 v", () => {
  const body = '{"events":[{"tStartMs":0,"dDurationMs":1000,"segs":[{"utf8":"wrong"}]}]}';
  for (const url of [
    "https://example.invalid/api/timedtext?v=video-id&lang=en&fmt=json3",
    "https://www.youtube.com/api/timedtext?lang=en&fmt=json3",
    "https://www.youtube.com/api/timedtext?v=old-video&lang=en&fmt=json3",
  ]) {
    assert.equal(transcriptFromYoutubeCapture({ ok: true, url, body }, "video-id"), null);
  }
});

test("播放器捕获失败时保留原生受限诊断", () => {
  const result = transcriptResultAfterPlayerCapture(
    { ok: false, code: "YOUTUBE_NATIVE_CAPTION_BLOCKED", trackCount: 2, videoId: "video-id" },
    { ok: false, code: "YOUTUBE_PLAYER_CAPTION_NOT_OBSERVED" },
  );

  assert.deepEqual(result, {
    ok: false,
    code: "YOUTUBE_NATIVE_CAPTION_BLOCKED",
    trackCount: 2,
    videoId: "video-id",
    playerCaptureCode: "YOUTUBE_PLAYER_CAPTION_NOT_OBSERVED",
  });
});
