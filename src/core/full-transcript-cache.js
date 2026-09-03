const FULL_TRANSCRIPT_CACHE_SCHEMA_VERSION = 1;

function validContextValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validTranscript(transcript, videoId) {
  return transcript?.ok === true
    && transcript.videoId === videoId
    && Array.isArray(transcript.cues)
    && transcript.cues.length > 0
    && transcript.cues.every((cue) => (
      Number.isFinite(cue?.startMs)
      && Number.isFinite(cue?.endMs)
      && cue.startMs >= 0
      && cue.endMs >= cue.startMs
      && validContextValue(cue.text)
    ));
}

function sameTranscript(left, right) {
  if (
    left?.source !== right?.source
    || left?.videoId !== right?.videoId
    || left?.languageCode !== right?.languageCode
    || left?.label !== right?.label
    || left?.automatic !== right?.automatic
    || left?.cues?.length !== right?.cues?.length
  ) return false;
  return left.cues.every((cue, index) => {
    const other = right.cues[index];
    return cue.startMs === other?.startMs
      && cue.endMs === other?.endMs
      && cue.text === other?.text;
  });
}

function translationSetKey(targetLanguage, groupSize) {
  const target = String(targetLanguage ?? "").trim();
  const size = Number(groupSize);
  return target && Number.isInteger(size) && size > 0
    ? `${target}:${size}`
    : "";
}

export function cachedFullTranscriptForContext(cache, { sessionId, videoId }) {
  if (
    cache?.schemaVersion !== FULL_TRANSCRIPT_CACHE_SCHEMA_VERSION
    || cache?.id !== sessionId
    || cache?.videoId !== videoId
    || !validTranscript(cache.transcript, videoId)
  ) return null;
  return cache.transcript;
}

export function createFullTranscriptCacheEntry({
  sessionId,
  videoId,
  transcript,
  previous = null,
  now = Date.now(),
}) {
  if (!validContextValue(sessionId) || !validContextValue(videoId)) {
    throw new Error("缺少完整字幕缓存的视频标识");
  }
  if (!validTranscript(transcript, videoId)) {
    throw new Error("完整字幕缓存内容无效");
  }
  const previousTranscript = cachedFullTranscriptForContext(previous, { sessionId, videoId });
  return {
    id: sessionId,
    schemaVersion: FULL_TRANSCRIPT_CACHE_SCHEMA_VERSION,
    videoId,
    transcript,
    translationSets: previousTranscript && sameTranscript(previousTranscript, transcript)
      ? { ...(previous.translationSets ?? {}) }
      : {},
    updatedAt: now,
  };
}

export function cachedFullTranscriptTranslations(cache, { targetLanguage, groupSize }) {
  const key = translationSetKey(targetLanguage, groupSize);
  const values = key ? cache?.translationSets?.[key] : null;
  if (!values || typeof values !== "object" || Array.isArray(values)) return new Map();
  return new Map(Object.entries(values).filter(([id, translation]) => (
    validContextValue(id) && validContextValue(translation)
  )));
}

export function fullTranscriptCacheWithTranslations(cache, {
  targetLanguage,
  groupSize,
  translations,
  now = Date.now(),
}) {
  const key = translationSetKey(targetLanguage, groupSize);
  if (!key || cache?.schemaVersion !== FULL_TRANSCRIPT_CACHE_SCHEMA_VERSION) return null;
  const values = Object.fromEntries(
    [...(translations?.entries?.() ?? [])]
      .filter(([id, translation]) => validContextValue(id) && validContextValue(translation))
      .map(([id, translation]) => [id, String(translation).trim()]),
  );
  return {
    ...cache,
    translationSets: {
      ...(cache.translationSets ?? {}),
      [key]: values,
    },
    updatedAt: now,
  };
}

export function createFullTranscriptCacheLoader({
  repository,
  fetchTranscript,
  now = Date.now,
  onCacheError = () => {},
}) {
  return {
    async load({ sessionId, videoId, force = false }) {
      let cache = null;
      try {
        cache = await repository.getTranscriptCache(sessionId);
      } catch (error) {
        onCacheError(error);
      }
      const cachedTranscript = cachedFullTranscriptForContext(cache, { sessionId, videoId });
      if (!force && cachedTranscript) {
        return { transcript: cachedTranscript, cache, source: "cache" };
      }

      const transcript = await fetchTranscript();
      if (!validTranscript(transcript, videoId)) {
        return { transcript, cache, source: "network" };
      }
      const nextCache = createFullTranscriptCacheEntry({
        sessionId,
        videoId,
        transcript,
        previous: cache,
        now: now(),
      });
      try {
        await repository.putTranscriptCache(nextCache);
      } catch (error) {
        onCacheError(error);
      }
      return { transcript, cache: nextCache, source: "network" };
    },
  };
}
