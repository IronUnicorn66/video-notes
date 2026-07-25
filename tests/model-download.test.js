import assert from "node:assert/strict";
import test from "node:test";

import { createModelDownloader, modelChunkKey } from "../src/core/model-download.js";

function createDownloadHarness({ corruptModelId = "", failAfterChunk = 0 } = {}) {
  const models = {
    base: {
      id: "base",
      url: "https://models/base.bin",
      size: 4,
      sha256: "base-sha",
      cacheName: "models",
      filename: "base.bin",
    },
    small: {
      id: "small",
      url: "https://models/small.bin",
      size: 4,
      sha256: "small-sha",
      cacheName: "models",
      filename: "small.bin",
    },
  };
  const cacheEntries = new Map();
  const cache = {
    async match(key) {
      return cacheEntries.get(key)?.clone();
    },
    async put(key, response) {
      cacheEntries.set(key, response.clone());
    },
    async delete(key) {
      return cacheEntries.delete(key);
    },
    has(key) {
      return cacheEntries.has(key);
    },
  };
  const rangeRequests = [];
  let interrupted = Boolean(failAfterChunk);
  const bytesByUrl = new Map([
    [models.base.url, new Uint8Array([1, 2, 3, 4])],
    [models.small.url, new Uint8Array([5, 6, 7, 8])],
  ]);

  const downloader = createModelDownloader({
    openCache: async () => cache,
    fetchResource: async (url, options) => {
      const range = options.headers.Range;
      rangeRequests.push(range);
      if (interrupted && rangeRequests.length > failAfterChunk) {
        throw new Error("网络中断");
      }
      const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(range);
      const bytes = bytesByUrl.get(url).slice(Number(start), Number(end) + 1);
      if (url === models[corruptModelId]?.url) bytes[0] = 0;
      return new Response(bytes, { status: 206 });
    },
    digest: async (buffer) => {
      const firstByte = new Uint8Array(buffer)[0];
      return firstByte === 1 ? "base-sha" : firstByte === 5 ? "small-sha" : "corrupt-sha";
    },
    readBundled: async () => undefined,
    chunkSize: 2,
  });

  return {
    cache,
    downloader,
    models,
    rangeRequests,
    resume() {
      interrupted = false;
    },
  };
}

test("不同模型使用独立完整文件键和分块键", () => {
  const base = { id: "base", url: "https://models/base.bin" };
  const small = { id: "small", url: "https://models/small.bin" };
  assert.notEqual(modelChunkKey(base, 0), modelChunkKey(small, 0));
});

test("下载完成只清理当前模型分块并保留其他模型", async () => {
  const harness = createDownloadHarness();
  await harness.downloader.download(harness.models.base);
  await harness.downloader.download(harness.models.small);

  assert.deepEqual(await harness.downloader.cachedIds(Object.values(harness.models)), ["base", "small"]);
  assert.equal(harness.cache.has(modelChunkKey(harness.models.base, 0)), false);
  assert.equal(harness.cache.has(harness.models.small.url), true);
});

test("大小或摘要校验失败时不写入完整模型", async () => {
  const harness = createDownloadHarness({ corruptModelId: "small" });

  await assert.rejects(() => harness.downloader.download(harness.models.small), /校验失败/);
  assert.equal(harness.cache.has(harness.models.small.url), false);
  assert.equal(harness.cache.has(modelChunkKey(harness.models.small, 0)), false);
});

test("中断后复用当前模型已经缓存的分块", async () => {
  const harness = createDownloadHarness({ failAfterChunk: 1 });

  await assert.rejects(() => harness.downloader.download(harness.models.small), /网络中断/);
  const requestsBeforeRetry = harness.rangeRequests.length;
  harness.resume();
  await harness.downloader.download(harness.models.small);

  assert.equal(harness.rangeRequests.slice(requestsBeforeRetry).includes("bytes=0-1"), false);
});
