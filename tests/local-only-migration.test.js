import assert from "node:assert/strict";
import test from "node:test";

import {
  clearLegacyCloudTranslationSettings,
  LEGACY_CLOUD_TRANSLATION_STORAGE_KEYS,
} from "../src/core/local-only-migration.js";

test("升级到纯本地翻译会删除所有旧云端配置", async () => {
  let removedKeys;
  await clearLegacyCloudTranslationSettings({
    async remove(keys) {
      removedKeys = keys;
    },
  });

  assert.deepEqual(removedKeys, [
    "fullTranscriptTranslationProvider",
    "fullTranscriptTranslationBaseUrl",
    "fullTranscriptTranslationApiKey",
    "fullTranscriptTranslationModel",
    "fullTranscriptTranslationOrigin",
    "fullTranscriptTranslationPendingOrigin",
  ]);
  assert.equal(removedKeys, LEGACY_CLOUD_TRANSLATION_STORAGE_KEYS);
});
