import assert from "node:assert/strict";
import test from "node:test";

import {
  clearTranslationSettings,
  saveTranslationSettings,
} from "../src/core/full-transcript-translation-settings.js";

const keys = [
  "fullTranscriptTranslationBaseUrl",
  "fullTranscriptTranslationApiKey",
  "fullTranscriptTranslationModel",
  "fullTranscriptTranslationOrigin",
  "fullTranscriptTranslationPendingOrigin",
];

const oldValues = {
  fullTranscriptTranslationBaseUrl: "https://old.example/v1",
  fullTranscriptTranslationApiKey: "old-key",
  fullTranscriptTranslationModel: "old-model",
  fullTranscriptTranslationOrigin: "https://old.example/*",
};

const newConfig = {
  origin: "https://new.example/*",
};

const newValues = {
  fullTranscriptTranslationBaseUrl: "https://new.example/v1",
  fullTranscriptTranslationApiKey: "new-key",
  fullTranscriptTranslationModel: "new-model",
  fullTranscriptTranslationOrigin: "https://new.example/*",
  fullTranscriptTranslationPendingOrigin: "",
};

function fixture({ oldRemoveResult = true, failSet = false } = {}) {
  const values = { ...oldValues };
  const granted = new Set([oldValues.fullTranscriptTranslationOrigin]);
  const storage = {
    values,
    async set(next) {
      if (failSet) throw new Error("storage failed");
      Object.assign(values, next);
    },
    async remove(removedKeys) {
      for (const key of removedKeys) delete values[key];
    },
  };
  const permissions = {
    granted,
    async contains({ origins }) {
      return granted.has(origins[0]);
    },
    async request({ origins }) {
      granted.add(origins[0]);
      return true;
    },
    async remove({ origins }) {
      if (origins[0] === oldValues.fullTranscriptTranslationOrigin && !oldRemoveResult) {
        return false;
      }
      granted.delete(origins[0]);
      return true;
    },
  };
  return { storage, permissions, values, granted };
}

test("撤销旧主机失败时保留旧设置并回收刚授予的新权限", async () => {
  const { storage, permissions, values, granted } = fixture({ oldRemoveResult: false });

  await assert.rejects(
    () => saveTranslationSettings({
      storage,
      permissions,
      stored: oldValues,
      config: newConfig,
      values: newValues,
    }),
    /无法撤销旧的翻译 API 权限/,
  );

  assert.deepEqual(values, oldValues);
  assert.deepEqual([...granted], [oldValues.fullTranscriptTranslationOrigin]);
});

test("保存失败时回收本次新增权限且不覆盖旧设置", async () => {
  const { storage, permissions, values, granted } = fixture({ failSet: true });

  await assert.rejects(() => saveTranslationSettings({
    storage,
    permissions,
    stored: oldValues,
    config: newConfig,
    values: newValues,
  }), /storage failed/);

  assert.deepEqual(values, oldValues);
  assert.equal(granted.has(oldValues.fullTranscriptTranslationOrigin), true);
  assert.equal(granted.has(newConfig.origin), false);
});

test("撤销权限失败时仍删除敏感配置并只保留待清理主机", async () => {
  const { storage, permissions, values, granted } = fixture({ oldRemoveResult: false });

  await assert.rejects(
    () => clearTranslationSettings({
      storage,
      permissions,
      stored: oldValues,
      keys,
    }),
    /配置已删除，但无法撤销旧的翻译 API 权限/,
  );

  assert.deepEqual(values, {
    fullTranscriptTranslationPendingOrigin: oldValues.fullTranscriptTranslationOrigin,
  });
  assert.equal(granted.has(oldValues.fullTranscriptTranslationOrigin), true);
});

test("成功切换和清空时同步更新权限与存储", async () => {
  const saved = fixture();
  await saveTranslationSettings({
    storage: saved.storage,
    permissions: saved.permissions,
    stored: oldValues,
    config: newConfig,
    values: newValues,
  });
  assert.deepEqual(saved.values, newValues);
  assert.deepEqual([...saved.granted], [newConfig.origin]);

  await clearTranslationSettings({
    storage: saved.storage,
    permissions: saved.permissions,
    stored: newValues,
    keys,
  });
  assert.deepEqual(saved.values, {});
  assert.deepEqual([...saved.granted], []);
});
