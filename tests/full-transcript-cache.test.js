import assert from "node:assert/strict";
import test from "node:test";

import {
  cachedFullTranscriptForContext,
  cachedFullTranscriptTranslations,
  createFullTranscriptCacheEntry,
  createFullTranscriptCacheLoader,
  fullTranscriptCacheWithTranslations,
} from "../src/core/full-transcript-cache.js";

function transcript(text = "第一段") {
  return {
    ok: true,
    source: "youtube-native-caption-track",
    videoId: "video-1",
    languageCode: "en",
    label: "English",
    automatic: false,
    cues: [{ startMs: 0, endMs: 1000, text }],
  };
}

test("完整字幕缓存只返回匹配当前视频的有效字幕", () => {
  const entry = createFullTranscriptCacheEntry({
    sessionId: "youtube:video-1",
    videoId: "video-1",
    transcript: transcript(),
    now: 10,
  });

  assert.equal(cachedFullTranscriptForContext(entry, {
    sessionId: "youtube:video-1",
    videoId: "video-1",
  }), entry.transcript);
  assert.equal(cachedFullTranscriptForContext(entry, {
    sessionId: "youtube:video-2",
    videoId: "video-2",
  }), null);
  assert.equal(cachedFullTranscriptForContext({ ...entry, schemaVersion: 0 }, {
    sessionId: "youtube:video-1",
    videoId: "video-1",
  }), null);
});

test("完整字幕译文按目标语言和合并档位分别缓存", () => {
  const entry = createFullTranscriptCacheEntry({
    sessionId: "youtube:video-1",
    videoId: "video-1",
    transcript: transcript(),
    now: 10,
  });
  const chinese = fullTranscriptCacheWithTranslations(entry, {
    targetLanguage: "zh-Hans",
    groupSize: 5,
    translations: new Map([["0:1", "第一段"]]),
    now: 20,
  });
  const english = fullTranscriptCacheWithTranslations(chinese, {
    targetLanguage: "es",
    groupSize: 10,
    translations: new Map([["0:1", "Primer párrafo"]]),
    now: 30,
  });

  assert.deepEqual(
    [...cachedFullTranscriptTranslations(english, {
      targetLanguage: "zh-Hans",
      groupSize: 5,
    })],
    [["0:1", "第一段"]],
  );
  assert.deepEqual(
    [...cachedFullTranscriptTranslations(english, {
      targetLanguage: "es",
      groupSize: 10,
    })],
    [["0:1", "Primer párrafo"]],
  );
  assert.deepEqual(
    [...cachedFullTranscriptTranslations(english, {
      targetLanguage: "zh-Hans",
      groupSize: 10,
    })],
    [],
  );
});

test("重新采集到相同字幕时保留译文，字幕变化时清空旧译文", () => {
  const original = fullTranscriptCacheWithTranslations(createFullTranscriptCacheEntry({
    sessionId: "youtube:video-1",
    videoId: "video-1",
    transcript: transcript(),
    now: 10,
  }), {
    targetLanguage: "zh-Hans",
    groupSize: 5,
    translations: new Map([["0:1", "第一段"]]),
    now: 20,
  });
  const unchanged = createFullTranscriptCacheEntry({
    sessionId: "youtube:video-1",
    videoId: "video-1",
    transcript: transcript(),
    previous: original,
    now: 30,
  });
  const changed = createFullTranscriptCacheEntry({
    sessionId: "youtube:video-1",
    videoId: "video-1",
    transcript: transcript("更新后的字幕"),
    previous: original,
    now: 40,
  });

  assert.equal(Object.keys(unchanged.translationSets).length, 1);
  assert.deepEqual(changed.translationSets, {});
});

test("再次打开同一视频优先使用缓存且不请求页面字幕", async () => {
  const entry = createFullTranscriptCacheEntry({
    sessionId: "youtube:video-1",
    videoId: "video-1",
    transcript: transcript(),
    now: 10,
  });
  let fetchCount = 0;
  const loader = createFullTranscriptCacheLoader({
    repository: {
      async getTranscriptCache() {
        return entry;
      },
      async putTranscriptCache() {
        throw new Error("缓存命中时不应写入");
      },
    },
    async fetchTranscript() {
      fetchCount += 1;
      return transcript("网络字幕");
    },
  });

  const result = await loader.load({
    sessionId: "youtube:video-1",
    videoId: "video-1",
  });

  assert.equal(result.source, "cache");
  assert.equal(result.transcript.cues[0].text, "第一段");
  assert.equal(fetchCount, 0);
});

test("手动重试会跳过缓存并保存重新采集的字幕", async () => {
  const entry = createFullTranscriptCacheEntry({
    sessionId: "youtube:video-1",
    videoId: "video-1",
    transcript: transcript(),
    now: 10,
  });
  const writes = [];
  const loader = createFullTranscriptCacheLoader({
    repository: {
      async getTranscriptCache() {
        return entry;
      },
      async putTranscriptCache(value) {
        writes.push(value);
      },
    },
    async fetchTranscript() {
      return transcript("网络字幕");
    },
    now: () => 20,
  });

  const result = await loader.load({
    sessionId: "youtube:video-1",
    videoId: "video-1",
    force: true,
  });

  assert.equal(result.source, "network");
  assert.equal(result.transcript.cues[0].text, "网络字幕");
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].translationSets, {});
});
