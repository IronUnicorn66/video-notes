import assert from "node:assert/strict";
import test from "node:test";

import {
  createAssetUrlRegistry,
  loadNoteAssets,
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
