import {
  createBrowserTranscriptTranslator,
  normalizedBrowserTranslationTargetLanguage,
} from "./browser-transcript-translation.js";

export const BROWSER_TRANSLATION_TARGET_LANGUAGES = Object.freeze([
  Object.freeze({ id: "zh-Hans", estimatedSizeMiB: 200 }),
  Object.freeze({ id: "en", estimatedSizeMiB: 200 }),
  Object.freeze({ id: "ja", estimatedSizeMiB: 200 }),
  Object.freeze({ id: "ko", estimatedSizeMiB: 200 }),
  Object.freeze({ id: "es", estimatedSizeMiB: 200 }),
]);

export function getBrowserTranslationTargetLanguage(targetLanguage) {
  const normalized = normalizedBrowserTranslationTargetLanguage(targetLanguage);
  return BROWSER_TRANSLATION_TARGET_LANGUAGES.find(({ id }) => id === normalized) ?? null;
}

export async function prepareBrowserTranslationLanguagePack(options) {
  let session;
  try {
    const created = await createBrowserTranscriptTranslator(options);
    session = created.session;
    return { pair: created.pair, availability: created.availability };
  } finally {
    try {
      session?.destroy();
    } catch {
      // Download success must not be masked when Edge has already released the temporary session.
    }
  }
}
