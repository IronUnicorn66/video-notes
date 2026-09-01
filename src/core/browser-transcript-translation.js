export const BROWSER_TRANSLATION_ERROR = Object.freeze({
  ALREADY_TARGET: "BROWSER_TRANSLATION_ALREADY_TARGET",
  DOWNLOAD_FAILED: "BROWSER_TRANSLATION_DOWNLOAD_FAILED",
  EMPTY_RESULT: "BROWSER_TRANSLATION_EMPTY_RESULT",
  UNAVAILABLE: "BROWSER_TRANSLATION_UNAVAILABLE",
  UNSUPPORTED: "BROWSER_TRANSLATION_UNSUPPORTED",
});

const TARGET_LANGUAGE_CANDIDATES = Object.freeze(["zh-Hans", "zh"]);

class BrowserTranslationError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "BrowserTranslationError";
    this.code = code;
  }
}

function normalizedLanguageTag(value) {
  return String(value ?? "").trim().replaceAll("_", "-");
}

function normalizedSourceLanguage(value) {
  const tag = normalizedLanguageTag(value);
  if (!tag) return "";
  const lower = tag.toLowerCase();
  const parts = lower.split("-");
  if (
    parts[0] === "zh"
    && (parts.includes("hant") || parts.some((part) => ["tw", "hk", "mo"].includes(part)))
  ) {
    return "zh-Hant";
  }
  if (parts[0] === "zh") return "zh";
  return lower.split("-")[0];
}

function isSimplifiedChinese(value) {
  return normalizedSourceLanguage(value) === "zh";
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException("The operation was aborted", "AbortError");
}

function isAbortError(error, signal) {
  return signal?.aborted || error?.name === "AbortError";
}

export function browserTranslationPairCandidates(sourceLanguage) {
  const source = normalizedSourceLanguage(sourceLanguage);
  if (!source) return [];
  return TARGET_LANGUAGE_CANDIDATES.map((targetLanguage) => ({
    sourceLanguage: source,
    targetLanguage,
  }));
}

function prioritizedPairs(sourceLanguage, preferredPair) {
  const candidates = browserTranslationPairCandidates(sourceLanguage);
  const preferredIndex = candidates.findIndex((pair) => (
    pair.sourceLanguage === preferredPair?.sourceLanguage
    && pair.targetLanguage === preferredPair?.targetLanguage
  ));
  if (preferredIndex <= 0) return candidates;
  return [
    candidates[preferredIndex],
    ...candidates.slice(0, preferredIndex),
    ...candidates.slice(preferredIndex + 1),
  ];
}

function validateBrowserTranslationRequest(sourceLanguage, translatorApi, { requireCreate = true } = {}) {
  if (isSimplifiedChinese(sourceLanguage)) {
    throw new BrowserTranslationError(
      BROWSER_TRANSLATION_ERROR.ALREADY_TARGET,
      "当前字幕已经是简体中文",
    );
  }
  if (
    !translatorApi
    || typeof translatorApi.availability !== "function"
    || (requireCreate && typeof translatorApi.create !== "function")
  ) {
    throw new BrowserTranslationError(
      BROWSER_TRANSLATION_ERROR.UNSUPPORTED,
      "当前浏览器不支持本地翻译",
    );
  }
  const pairs = browserTranslationPairCandidates(sourceLanguage);
  if (pairs.length === 0) {
    throw new BrowserTranslationError(
      BROWSER_TRANSLATION_ERROR.UNAVAILABLE,
      "无法识别字幕语言，本地翻译不可用",
    );
  }
}

export async function browserTranscriptTranslationAvailability({
  sourceLanguage,
  translatorApi = globalThis.Translator,
  preferredPair,
  signal,
} = {}) {
  validateBrowserTranslationRequest(
    sourceLanguage,
    translatorApi,
    { requireCreate: false },
  );
  let lastError;
  for (const pair of prioritizedPairs(sourceLanguage, preferredPair)) {
    throwIfAborted(signal);
    try {
      const availability = await translatorApi.availability(pair);
      if (availability !== "unavailable") return { pair, availability };
    } catch (error) {
      if (isAbortError(error, signal)) throw error;
      lastError = error;
    }
  }
  throw new BrowserTranslationError(
    BROWSER_TRANSLATION_ERROR.UNAVAILABLE,
    lastError?.message ? `本地翻译不可用：${lastError.message}` : "当前语言对不支持本地翻译",
    lastError ? { cause: lastError } : undefined,
  );
}

function observeDownloadProgress(monitor, onDownloadProgress) {
  if (typeof onDownloadProgress !== "function") return;
  monitor.addEventListener("downloadprogress", (event) => {
    const loaded = Number(event.loaded);
    const total = Number(event.total);
    const progress = Number.isFinite(total) && total > 0 ? loaded / total : loaded;
    if (Number.isFinite(progress)) onDownloadProgress(Math.min(1, Math.max(0, progress)));
  });
}

export async function createBrowserTranscriptTranslator({
  sourceLanguage,
  translatorApi = globalThis.Translator,
  preferredPair,
  signal,
  onDownloadProgress,
} = {}) {
  validateBrowserTranslationRequest(sourceLanguage, translatorApi);
  const pairs = prioritizedPairs(sourceLanguage, preferredPair);

  let lastError;
  let downloadFailed = false;
  for (const pair of pairs) {
    throwIfAborted(signal);
    let availability;
    try {
      availability = await translatorApi.availability(pair);
    } catch (error) {
      if (isAbortError(error, signal)) throw error;
      lastError = error;
      continue;
    }
    if (availability === "unavailable") continue;
    try {
      const session = await translatorApi.create({
        ...pair,
        signal,
        monitor: (monitor) => observeDownloadProgress(monitor, onDownloadProgress),
      });
      return { session, pair, availability };
    } catch (error) {
      if (isAbortError(error, signal)) throw error;
      lastError = error;
      downloadFailed ||= availability === "downloadable" || availability === "downloading";
    }
  }

  const detail = String(lastError?.message ?? "").trim();
  throw new BrowserTranslationError(
    downloadFailed
      ? BROWSER_TRANSLATION_ERROR.DOWNLOAD_FAILED
      : BROWSER_TRANSLATION_ERROR.UNAVAILABLE,
    detail ? `本地翻译不可用：${detail}` : "当前语言对不支持本地翻译",
    lastError ? { cause: lastError } : undefined,
  );
}

export async function translateBrowserTranscriptCues({
  session,
  cues,
  signal,
  onTranslated = () => {},
}) {
  const translations = [];
  for (const cue of cues) {
    throwIfAborted(signal);
    const translated = await session.translate(cue.text, { signal });
    throwIfAborted(signal);
    const translation = String(translated ?? "").trim();
    if (!translation) {
      throw new BrowserTranslationError(
        BROWSER_TRANSLATION_ERROR.EMPTY_RESULT,
        "本地翻译返回了空结果",
      );
    }
    const result = { id: cue.id, translation };
    translations.push(result);
    await onTranslated(result);
  }
  return translations;
}
