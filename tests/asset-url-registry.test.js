import assert from "node:assert/strict";
import test from "node:test";

import {
  createAssetUrlRegistry,
  loadNoteAssets,
  stopNoteMedia,
} from "../src/core/asset-url-registry.js";

test("替换同一资产时回收旧 URL", () => {
  const revoked = [];
  let sequence = 0;
  const registry = createAssetUrlRegistry({
    createObjectURL: () => `blob:test-${++sequence}`,
    revokeObjectURL: (url) => revoked.push(url),
  });
  assert.equal(registry.set("images/1", new Blob()), "blob:test-1");
  assert.equal(registry.set("images/1", new Blob()), "blob:test-2");
  assert.deepEqual(revoked, ["blob:test-1"]);
});

test("刷新和卸载时回收全部 URL", () => {
  const revoked = [];
  const registry = createAssetUrlRegistry({
    createObjectURL: (_, key) => `blob:${key}`,
    revokeObjectURL: (url) => revoked.push(url),
  });
  registry.set("images/1", new Blob());
  registry.set("audio/1", new Blob());
  registry.revokeAll();
  assert.equal(registry.size, 0);
  assert.equal(revoked.length, 2);
});

test("读取截图和录音并报告缺失资产", async () => {
  const registry = createAssetUrlRegistry({
    createObjectURL: () => "blob:asset",
    revokeObjectURL: () => {},
  });
  const assets = new Map([
    ["images/1", new Blob(["image"])],
  ]);
  const result = await loadNoteAssets(
    { screenshotKey: "images/1", audioKey: "audio/1" },
    { getAsset: (key) => assets.get(key), registry },
  );
  assert.equal(result.screenshotUrl, "blob:asset");
  assert.equal(result.audioUrl, "");
  assert.deepEqual(result.warnings, ["录音资产缺失"]);
});

test("资产读取失败时保留其余资产并报告局部告警", async () => {
  const registry = createAssetUrlRegistry({
    createObjectURL: () => "blob:audio",
    revokeObjectURL: () => {},
  });
  const result = await loadNoteAssets(
    { screenshotKey: "images/1", audioKey: "audio/1" },
    {
      getAsset: (key) => key === "images/1"
        ? Promise.reject(new Error("IndexedDB 读取失败"))
        : Promise.resolve(new Blob(["audio"])),
      registry,
    },
  );
  assert.equal(result.screenshotUrl, "");
  assert.equal(result.audioUrl, "blob:audio");
  assert.deepEqual(result.warnings, ["截图资产缺失"]);
});

test("失效渲染代次不会创建对象 URL", async () => {
  const created = [];
  const revoked = [];
  const registry = createAssetUrlRegistry({
    createObjectURL: () => {
      const url = `blob:stale-${created.length + 1}`;
      created.push(url);
      return url;
    },
    revokeObjectURL: (url) => revoked.push(url),
  });
  const result = await loadNoteAssets(
    { screenshotKey: "images/1", audioKey: "audio/1" },
    {
      getAsset: () => Promise.resolve(new Blob()),
      registry,
      isCurrent: () => false,
    },
  );
  assert.equal(result.stale, true);
  assert.deepEqual(created, []);
  assert.equal(registry.size, 0);
  registry.revokeAll();
  assert.deepEqual(revoked, []);
});

test("重复资产键为每张卡片保留独立对象 URL", async () => {
  const revoked = [];
  let sequence = 0;
  const registry = createAssetUrlRegistry({
    createObjectURL: () => `blob:shared-${++sequence}`,
    revokeObjectURL: (url) => revoked.push(url),
  });
  const options = {
    getAsset: () => Promise.resolve(new Blob(["image"])),
    registry,
  };
  const first = await loadNoteAssets(
    { screenshotKey: "images/shared" },
    { ...options, registryKeyPrefix: "note:first:" },
  );
  const second = await loadNoteAssets(
    { screenshotKey: "images/shared" },
    { ...options, registryKeyPrefix: "note:second:" },
  );
  assert.equal(first.screenshotUrl, "blob:shared-1");
  assert.equal(second.screenshotUrl, "blob:shared-2");
  assert.deepEqual(revoked, []);
  registry.revokeAll();
  assert.deepEqual(revoked, ["blob:shared-1", "blob:shared-2"]);
});

test("回收媒体时先停止播放再移除来源并重载", () => {
  const calls = [];
  const audio = {
    pause: () => calls.push("pause"),
    removeAttribute: (name) => calls.push(`remove:${name}`),
    load: () => calls.push("load"),
  };
  stopNoteMedia({ querySelectorAll: () => [audio] });
  assert.deepEqual(calls, ["pause", "remove:src", "load"]);
});
