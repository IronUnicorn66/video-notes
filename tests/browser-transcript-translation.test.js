import assert from "node:assert/strict";
import test from "node:test";

import {
  BROWSER_TRANSLATION_ERROR,
  browserTranscriptTranslationAvailability,
  browserTranslationPairCandidates,
  createBrowserTranscriptTranslator,
  translateBrowserTranscriptCues,
} from "../src/core/browser-transcript-translation.js";

test("浏览器本地翻译将地区语言码归一化并依次尝试两种简体中文代码", () => {
  assert.deepEqual(browserTranslationPairCandidates("en-US"), [
    { sourceLanguage: "en", targetLanguage: "zh-Hans" },
    { sourceLanguage: "en", targetLanguage: "zh" },
  ]);
  assert.deepEqual(browserTranslationPairCandidates("zh-TW"), [
    { sourceLanguage: "zh-Hant", targetLanguage: "zh-Hans" },
    { sourceLanguage: "zh-Hant", targetLanguage: "zh" },
  ]);
  assert.deepEqual(browserTranslationPairCandidates("zh-Hant-TW"), [
    { sourceLanguage: "zh-Hant", targetLanguage: "zh-Hans" },
    { sourceLanguage: "zh-Hant", targetLanguage: "zh" },
  ]);
});

test("简体中文字幕不创建无意义的本地翻译会话", async () => {
  await assert.rejects(
    () => createBrowserTranscriptTranslator({
      translatorApi: {},
      sourceLanguage: "zh-CN",
    }),
    (error) => error.code === BROWSER_TRANSLATION_ERROR.ALREADY_TARGET,
  );
});

test("浏览器缺少 Translator API 时返回可识别的错误", async () => {
  await assert.rejects(
    () => createBrowserTranscriptTranslator({
      translatorApi: undefined,
      sourceLanguage: "en",
    }),
    (error) => error.code === BROWSER_TRANSLATION_ERROR.UNSUPPORTED,
  );
});

test("Edge 与 Chrome 中文代码不同时会跳过不可用语言对", async () => {
  const checked = [];
  const created = [];
  const session = { translate: async () => "译文", destroy() {} };
  const result = await createBrowserTranscriptTranslator({
    sourceLanguage: "en-US",
    translatorApi: {
      async availability(pair) {
        checked.push(pair);
        return pair.targetLanguage === "zh-Hans" ? "unavailable" : "available";
      },
      async create(options) {
        created.push(options);
        return session;
      },
    },
  });

  assert.deepEqual(checked, [
    { sourceLanguage: "en", targetLanguage: "zh-Hans" },
    { sourceLanguage: "en", targetLanguage: "zh" },
  ]);
  assert.equal(created.length, 1);
  assert.equal(created[0].targetLanguage, "zh");
  assert.equal(result.session, session);
  assert.deepEqual(result.pair, { sourceLanguage: "en", targetLanguage: "zh" });
});

test("语言包状态检测会返回当前浏览器可用的中文语言代码", async () => {
  const result = await browserTranscriptTranslationAvailability({
    sourceLanguage: "en-US",
    translatorApi: {
      async availability({ targetLanguage }) {
        return targetLanguage === "zh-Hans" ? "unavailable" : "downloadable";
      },
    },
  });

  assert.deepEqual(result, {
    availability: "downloadable",
    pair: { sourceLanguage: "en", targetLanguage: "zh" },
  });
});

test("语言包状态检测在浏览器拒绝一种中文代码后继续回退", async () => {
  const checked = [];
  const result = await browserTranscriptTranslationAvailability({
    sourceLanguage: "en",
    translatorApi: {
      async availability({ targetLanguage }) {
        checked.push(targetLanguage);
        if (targetLanguage === "zh-Hans") throw new TypeError("invalid language tag");
        return "available";
      },
    },
  });

  assert.deepEqual(checked, ["zh-Hans", "zh"]);
  assert.equal(result.pair.targetLanguage, "zh");
});

test("可下载状态创建会话并转发语言包下载进度", async () => {
  const progress = [];
  const result = await createBrowserTranscriptTranslator({
    sourceLanguage: "en",
    onDownloadProgress: (value) => progress.push(value),
    translatorApi: {
      availability: async () => "downloadable",
      async create({ monitor }) {
        const listeners = new Map();
        monitor({
          addEventListener(type, listener) {
            listeners.set(type, listener);
          },
        });
        listeners.get("downloadprogress")({ loaded: 0.25, total: 1 });
        listeners.get("downloadprogress")({ loaded: 1, total: 1 });
        return { translate: async () => "译文", destroy() {} };
      },
    },
  });

  assert.equal(result.availability, "downloadable");
  assert.deepEqual(progress, [0.25, 1]);
});

test("创建失败后继续尝试另一种简体中文代码并缓存命中语言对", async () => {
  const createdTargets = [];
  const session = { translate: async () => "译文", destroy() {} };
  const translatorApi = {
    availability: async () => "downloadable",
    async create({ targetLanguage }) {
      createdTargets.push(targetLanguage);
      if (targetLanguage === "zh-Hans") throw new Error("language pair unavailable");
      return session;
    },
  };

  const first = await createBrowserTranscriptTranslator({
    translatorApi,
    sourceLanguage: "en",
  });
  assert.deepEqual(createdTargets, ["zh-Hans", "zh"]);

  createdTargets.length = 0;
  const second = await createBrowserTranscriptTranslator({
    translatorApi,
    sourceLanguage: "en",
    preferredPair: first.pair,
  });
  assert.deepEqual(createdTargets, ["zh"]);
  assert.equal(second.session, session);
});

test("语言包下载失败会返回独立错误状态", async () => {
  await assert.rejects(
    () => createBrowserTranscriptTranslator({
      sourceLanguage: "en",
      translatorApi: {
        availability: async () => "downloadable",
        create: async () => {
          throw new Error("download interrupted");
        },
      },
    }),
    (error) => error.code === BROWSER_TRANSLATION_ERROR.DOWNLOAD_FAILED,
  );
});

test("本地翻译逐条保留字幕序号、报告进度并拒绝空结果", async () => {
  const completed = [];
  const translations = await translateBrowserTranscriptCues({
    session: {
      async translate(text) {
        return { One: "一", Two: "二" }[text];
      },
    },
    cues: [
      { id: 4, text: "One" },
      { id: 7, text: "Two" },
    ],
    onTranslated: (result) => completed.push(result),
  });

  assert.deepEqual(translations, [
    { id: 4, translation: "一" },
    { id: 7, translation: "二" },
  ]);
  assert.deepEqual(completed, translations);

  await assert.rejects(
    () => translateBrowserTranscriptCues({
      session: { translate: async () => "  " },
      cues: [{ id: 1, text: "Empty" }],
    }),
    (error) => error.code === BROWSER_TRANSLATION_ERROR.EMPTY_RESULT,
  );
});

test("中断信号会停止后续字幕翻译", async () => {
  const controller = new AbortController();
  const requested = [];
  await assert.rejects(
    () => translateBrowserTranscriptCues({
      session: {
        async translate(text) {
          requested.push(text);
          controller.abort();
          return "一";
        },
      },
      cues: [
        { id: 0, text: "One" },
        { id: 1, text: "Two" },
      ],
      signal: controller.signal,
    }),
    (error) => error.name === "AbortError",
  );
  assert.deepEqual(requested, ["One"]);
});
