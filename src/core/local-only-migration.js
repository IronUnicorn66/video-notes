export const LEGACY_CLOUD_TRANSLATION_STORAGE_KEYS = Object.freeze([
  "fullTranscriptTranslationProvider",
  "fullTranscriptTranslationBaseUrl",
  "fullTranscriptTranslationApiKey",
  "fullTranscriptTranslationModel",
  "fullTranscriptTranslationOrigin",
  "fullTranscriptTranslationPendingOrigin",
]);

export async function clearLegacyCloudTranslationSettings(storage) {
  await storage.remove(LEGACY_CLOUD_TRANSLATION_STORAGE_KEYS);
}
