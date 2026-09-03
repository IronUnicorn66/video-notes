import assert from "node:assert/strict";
import test from "node:test";

const bilibiliTranscript = await import("../src/core/bilibili-transcript.js").catch(() => ({}));

const { BilibiliTranscriptSource, readBilibiliNativeTranscript } = bilibiliTranscript;

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return body;
    },
  };
}

test("B 站原生字幕轨道关闭时仍按当前分 P 读取完整字幕", async () => {
  assert.equal(typeof readBilibiliNativeTranscript, "function");

  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (url === "https://api.bilibili.com/x/web-interface/view?bvid=BV1example") {
      return jsonResponse({
        code: 0,
        data: {
          aid: 123,
          bvid: "BV1example",
          pages: [
            { cid: 456, page: 1 },
            { cid: 789, page: 2 },
          ],
        },
      });
    }
    if (url === "https://api.bilibili.com/x/player/wbi/v2?aid=123&cid=789") {
      return jsonResponse({
        code: 0,
        data: {
          subtitle: {
            subtitles: [
              {
                id: 2,
                lan: "en-US",
                lan_doc: "English",
                subtitle_url: "//i0.hdslb.com/bfs/subtitle/english.json",
              },
              {
                id: 1,
                lan: "zh-CN",
                lan_doc: "中文",
                subtitle_url: "//i0.hdslb.com/bfs/subtitle/chinese.json",
              },
            ],
          },
        },
      });
    }
    if (url === "https://i0.hdslb.com/bfs/subtitle/chinese.json") {
      return jsonResponse({
        body: [
          { from: 10.25, to: 12.5, content: "  第一条字幕  " },
          { from: 12.5, to: 15, content: "第二条\n字幕" },
        ],
      });
    }
    throw new Error(`意外请求：${url}`);
  };

  const result = await readBilibiliNativeTranscript({
    fetchImpl,
    videoId: "BV1example",
    part: 2,
    preferredLanguages: ["zh-CN", "en-US"],
  });

  assert.deepEqual(result, {
    ok: true,
    source: "bilibili-native-subtitle-track",
    videoId: "BV1example",
    languageCode: "zh-CN",
    label: "中文",
    cues: [
      { startMs: 10250, endMs: 12500, text: "第一条字幕" },
      { startMs: 12500, endMs: 15000, text: "第二条 字幕" },
    ],
  });
  assert.deepEqual(requests, [
    {
      url: "https://api.bilibili.com/x/web-interface/view?bvid=BV1example",
      options: { credentials: "include" },
    },
    {
      url: "https://api.bilibili.com/x/player/wbi/v2?aid=123&cid=789",
      options: { credentials: "include" },
    },
    {
      url: "https://i0.hdslb.com/bfs/subtitle/chinese.json",
      options: { credentials: "include" },
    },
  ]);
});

test("B 站字幕接口无轨道时返回可回退状态", async () => {
  assert.equal(typeof readBilibiliNativeTranscript, "function");

  const responses = [
    jsonResponse({
      code: 0,
      data: { aid: 123, pages: [{ cid: 456, page: 1 }] },
    }),
    jsonResponse({
      code: 0,
      data: { subtitle: { subtitles: [] } },
    }),
  ];

  const result = await readBilibiliNativeTranscript({
    fetchImpl: async () => responses.shift(),
    videoId: "BV1example",
    part: 1,
  });

  assert.deepEqual(result, {
    ok: false,
    code: "BILIBILI_SUBTITLE_TRACKS_MISSING",
    trackCount: 0,
    videoId: "BV1example",
  });
});

test("B 站字幕只读取可信 CDN 的 JSON 地址", async () => {
  assert.equal(typeof readBilibiliNativeTranscript, "function");

  const responses = [
    jsonResponse({
      code: 0,
      data: { aid: 123, pages: [{ cid: 456, page: 1 }] },
    }),
    jsonResponse({
      code: 0,
      data: {
        subtitle: {
          subtitles: [{
            id: 1,
            lan: "zh-CN",
            lan_doc: "中文",
            subtitle_url: "https://example.com/private.json",
          }],
        },
      },
    }),
  ];

  const result = await readBilibiliNativeTranscript({
    fetchImpl: async () => responses.shift(),
    videoId: "BV1example",
    part: 1,
  });

  assert.deepEqual(result, {
    ok: false,
    code: "BILIBILI_SUBTITLE_TRACKS_MISSING",
    trackCount: 0,
    videoId: "BV1example",
  });
});

test("B 站字幕源按当前视频缓存并转换为记笔记分段", async () => {
  assert.equal(typeof BilibiliTranscriptSource, "function");

  const context = {
    platform: "bilibili",
    sessionId: "bilibili:BV1example:2",
    videoId: "BV1example",
    part: 2,
  };
  const requests = [];
  const controller = new BilibiliTranscriptSource({
    readTranscript: async (options) => {
      requests.push(options);
      return {
        ok: true,
        videoId: "BV1example",
        cues: [{ startMs: 1000, endMs: 2500, text: "字幕" }],
      };
    },
  });

  const loaded = await controller.load(context, { preferredLanguages: ["zh-CN"] });

  assert.deepEqual(loaded, {
    sessionId: context.sessionId,
    videoId: context.videoId,
    groups: [{ startMs: 1000, endMs: 2500, text: "字幕" }],
  });
  assert.equal(controller.get(context), loaded);
  assert.equal(await controller.load(context), loaded);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].preferredLanguages, ["zh-CN"]);
});

test("B 站切换视频后丢弃上一视频尚未返回的字幕", async () => {
  assert.equal(typeof BilibiliTranscriptSource, "function");

  let finish;
  const controller = new BilibiliTranscriptSource({
    readTranscript: () => new Promise((resolve) => {
      finish = resolve;
    }),
  });
  const context = {
    platform: "bilibili",
    sessionId: "bilibili:BV1old:1",
    videoId: "BV1old",
    part: 1,
  };

  const pending = controller.load(context);
  controller.clear();
  finish({
    ok: true,
    videoId: context.videoId,
    cues: [{ startMs: 0, endMs: 1000, text: "旧视频字幕" }],
  });

  assert.equal(await pending, null);
  assert.equal(controller.get(context), null);
});

test("非 B 站页面不发起 B 站字幕请求", async () => {
  assert.equal(typeof BilibiliTranscriptSource, "function");

  let requestCount = 0;
  const controller = new BilibiliTranscriptSource({
    readTranscript: async () => {
      requestCount += 1;
      return { ok: false };
    },
  });

  assert.equal(await controller.load({ platform: "youtube" }), null);
  assert.equal(requestCount, 0);
});
