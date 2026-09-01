import assert from "node:assert/strict";
import test from "node:test";

import {
  chunkTranscriptCues,
  normalizeFullTranscriptTranslationConfig,
  parseTranscriptTranslations,
  requestTranslationHostPermission,
  translateTranscriptBatch,
  untranslatedTranscriptCues,
} from "../src/core/full-transcript-translation.js";

const config = {
  baseUrl: "https://api.example.com/v1/",
  apiKey: "test-api-key",
  model: "example-mini",
};

test("翻译配置规范化 Base URL、端点和单一主机权限", () => {
  assert.deepEqual(normalizeFullTranscriptTranslationConfig(config), {
    baseUrl: "https://api.example.com/v1",
    endpoint: "https://api.example.com/v1/chat/completions",
    origin: "https://api.example.com/*",
    apiKey: "test-api-key",
    model: "example-mini",
  });
});

test("翻译配置拒绝不完整、非 HTTPS 或误填完整端点的值", () => {
  assert.throws(
    () => normalizeFullTranscriptTranslationConfig({ ...config, apiKey: "" }),
    /API Key/,
  );
  assert.throws(
    () => normalizeFullTranscriptTranslationConfig({ ...config, baseUrl: "http://api.example.com/v1" }),
    /HTTPS/,
  );
  assert.throws(
    () => normalizeFullTranscriptTranslationConfig({
      ...config,
      baseUrl: "https://api.example.com/v1/chat/completions",
    }),
    /Base URL/,
  );
});

test("翻译批次固定每四十条并保留末组", () => {
  const cues = Array.from({ length: 81 }, (_, id) => ({
    startMs: id * 1000,
    endMs: (id + 1) * 1000,
    text: `字幕 ${id}`,
  }));

  assert.deepEqual(
    chunkTranscriptCues(cues).map((batch) => batch.map((cue) => cue.id)),
    [
      Array.from({ length: 40 }, (_, id) => id),
      Array.from({ length: 40 }, (_, id) => id + 40),
      [80],
    ],
  );
});

test("中断后只保留尚未翻译的字幕及其原始序号以便继续翻译", () => {
  assert.deepEqual(
    untranslatedTranscriptCues([
      { text: "One", translation: "一" },
      { text: "Two" },
      { text: "Three", translation: "三" },
    ]),
    [{ id: 1, text: "Two" }],
  );
});

test("翻译 API 权限只请求配置主机，拒绝时返回未授权", async () => {
  const requested = [];
  const granted = await requestTranslationHostPermission({
    contains: async () => false,
    request: async (permission) => {
      requested.push(permission);
      return false;
    },
  }, normalizeFullTranscriptTranslationConfig(config));

  assert.equal(granted, false);
  assert.deepEqual(requested, [{ origins: ["https://api.example.com/*"] }]);
});

test("翻译响应按字幕序号映射并拒绝缺失或重复序号", () => {
  const batch = [
    { id: 7, text: "One" },
    { id: 8, text: "Two" },
  ];

  assert.deepEqual(
    parseTranscriptTranslations(
      '{"translations":[{"id":8,"text":"二"},{"id":7,"text":"一"}]}',
      batch,
    ),
    [
      { id: 7, translation: "一" },
      { id: 8, translation: "二" },
    ],
  );
  assert.throws(
    () => parseTranscriptTranslations('{"translations":[{"id":7,"text":"一"}]}', batch),
    /不完整/,
  );
  assert.throws(
    () => parseTranscriptTranslations(
      '{"translations":[{"id":7,"text":"一"},{"id":7,"text":"重复"}]}',
      batch,
    ),
    /重复/,
  );
});

test("翻译请求使用用户模型、四十条以内字幕和 OpenAI 兼容端点", async () => {
  let requestedUrl;
  let requestedInit;
  const translated = await translateTranscriptBatch({
    config: normalizeFullTranscriptTranslationConfig(config),
    cues: [
      { id: 0, text: "Welcome" },
      { id: 1, text: "Overview" },
    ],
    fetchImpl: async (url, init) => {
      requestedUrl = url;
      requestedInit = init;
      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: '{"translations":[{"id":0,"text":"欢迎"},{"id":1,"text":"概览"}]}',
            },
          }],
        }),
      };
    },
  });

  assert.equal(requestedUrl, "https://api.example.com/v1/chat/completions");
  assert.equal(requestedInit.headers.Authorization, "Bearer test-api-key");
  assert.equal(JSON.parse(requestedInit.body).model, "example-mini");
  assert.deepEqual(translated, [
    { id: 0, translation: "欢迎" },
    { id: 1, translation: "概览" },
  ]);
});
